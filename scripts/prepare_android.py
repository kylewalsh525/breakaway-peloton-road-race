#!/usr/bin/env python3
"""Prepare the offline speech model, Gradle, and game assets. Requires network access.
No Android SDK is silently installed; configure ANDROID_HOME or Android Studio first.
Model ZIP is checked against the user's approved/pinned digest when supplied. On first
use the HTTPS download digest is recorded so subsequent builds can be pinned in CI.
"""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, sys, urllib.request, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / '.build-cache'
MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip'
GRADLE_VERSION = '8.11.1'
GRADLE_URL = f'https://services.gradle.org/distributions/gradle-{GRADLE_VERSION}-bin.zip'

def fetch(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix+'.partial')
    try:
        with urllib.request.urlopen(url, timeout=60) as source, open(temp, 'wb') as dest:
            shutil.copyfileobj(source, dest)
        temp.replace(target)
    finally:
        if temp.exists(): temp.unlink()

def digest(path):
    with open(path, 'rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()

def extract_safe(archive, destination):
    destination = destination.resolve()
    with zipfile.ZipFile(archive) as file:
        total = 0
        for entry in file.infolist():
            output = (destination/entry.filename).resolve()
            if not output.is_relative_to(destination) or ((entry.external_attr >> 16) & 0o170000) == 0o120000:
                raise ValueError('Unsafe ZIP entry')
            total += entry.file_size
            if total > 2_000_000_000:
                raise ValueError('Archive exceeds extraction limit')
        file.extractall(destination)

def model():
    archive = CACHE/'vosk-model-small-en-us-0.15.zip'
    if not archive.exists(): fetch(MODEL_URL,archive)
    actual = digest(archive)
    pin = os.environ.get('VOSK_MODEL_SHA256')
    lock = ROOT/'android/model-lock.json'
    if not pin and lock.exists(): pin = json.loads(lock.read_text())['sha256']
    if pin and actual.lower() != pin.lower():
        archive.unlink()
        raise ValueError('Vosk model checksum mismatch; do not build')
    if not pin:
        print('First-use model trust: downloaded over HTTPS. Review and retain android/model-lock.json for reproducible builds.')
    lock.write_text(json.dumps({'url':MODEL_URL,'sha256':actual,'license':'Apache-2.0','firstUseVerifiedBy':'HTTPS origin, not independent cryptographic attestation'},indent=2)+'\n')
    dest = ROOT/'android/app/src/main/assets/model'
    unpack = CACHE/'model-unpacked'
    if unpack.exists(): shutil.rmtree(unpack)
    extract_safe(archive,unpack)
    source = unpack/'vosk-model-small-en-us-0.15'
    if not (source/'am/final.mdl').is_file(): raise ValueError('Unexpected model contents')
    if dest.exists(): shutil.rmtree(dest)
    shutil.copytree(source,dest)
    print('Offline model prepared:',actual)

def gradle():
    binary=CACHE/f'gradle-{GRADLE_VERSION}'/'bin'/('gradle.bat' if os.name=='nt' else 'gradle')
    if binary.exists(): return binary
    archive=CACHE/f'gradle-{GRADLE_VERSION}-bin.zip'
    checksum=CACHE/f'gradle-{GRADLE_VERSION}-bin.zip.sha256'
    if not archive.exists(): fetch(GRADLE_URL,archive)
    fetch(GRADLE_URL+'.sha256',checksum)
    if digest(archive)!=checksum.read_text().strip().split()[0]:
        archive.unlink();raise ValueError('Gradle checksum mismatch')
    extract_safe(archive,CACHE)
    if os.name!='nt': binary.chmod(0o755)
    return binary

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-only',action='store_true')
    parser.add_argument('--skip-model',action='store_true',help='Development only; native offline voice will be unavailable.')
    parser.add_argument('tasks',nargs='*',default=[':app:testDebugUnitTest',':app:assembleDebug'])
    args=parser.parse_args()
    try:
        subprocess.run(['node',str(ROOT/'scripts/build.mjs')],cwd=ROOT,check=True)
        if not args.skip_model: model()
        if args.model_only: return
        binary=gradle()
        subprocess.run([str(binary),'--no-daemon',*args.tasks],cwd=ROOT/'android',check=True)
    except (OSError,ValueError,subprocess.CalledProcessError) as error:
        print('Android preparation/build failed:',error,file=sys.stderr);sys.exit(1)

if __name__=='__main__': main()
