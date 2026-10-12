#!/usr/bin/env python3
"""Rendered UI tests of the bundled build. No external URLs, microphones, or device services.
Uses set_content so it also works in environments whose browser policy blocks navigation.
Native and speech events are explicitly synthetic fixtures, never hardware certification.
"""
import json, os, pathlib, time
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
HTML=(ROOT/'dist/PLAY-SOLO.html').read_text()
ARTIFACTS=ROOT/'artifacts'
checks=[]
errors=[]

def check(name,condition):
    if not condition: raise AssertionError(name)
    checks.append(name)
    print("PASS:",name,flush=True)

def load(browser,viewport={'width':1440,'height':900},prelude=''):
    page=browser.new_page(viewport=viewport,reduced_motion='reduce')
    page.set_default_timeout(7000)
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content(HTML.replace('<head>','<head><script>'+prelude+'</script>',1),wait_until='domcontentloaded')
    page.wait_for_function('window.breakawayStarted===true')
    page.wait_for_timeout(200)
    return page

def diag(page): return page.evaluate('window.breakawayDiagnostics()')
def screenshot(page,name): page.screenshot(path=str(ARTIFACTS/name))

def main():
    start=time.monotonic()
    with sync_playwright() as p:
        executable=os.environ.get('CHROMIUM_PATH')
        if not executable and pathlib.Path('/usr/bin/chromium').exists(): executable='/usr/bin/chromium'
        options={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
        if executable: options['executable_path']=executable
        browser=p.chromium.launch(**options)
        page=load(browser)
        check('Desktop garage loads without page errors',diag(page)['screen']=='home')
        check('Four selectable original courses',page.locator('[data-track]').count()==4)
        box=page.locator('#practice-btn').bounding_box()
        check('Primary start control is visible inside viewport',box['y']>0 and box['y']+box['height']<900)
        page.locator('#rider-name').fill('Road tester')
        screenshot(page,'home-desktop.png')
        for track in ['coast','canyon','metro','alpine']:
            page.click('[data-track="'+track+'"]')
            check('Selected track '+track,page.locator('[data-track="'+track+'"]').get_attribute('aria-pressed')=='true')
            page.wait_for_timeout(120)
            if track!='coast': screenshot(page,'garage-'+track+'.png')
        page.click('[data-track="coast"]')
        page.click('#quick-btn')
        check('Standalone multiplayer gives actionable server instructions','npm start' in page.locator('#toast').inner_text())
        page.click('#settings-btn')
        page.select_option('#setting-quality','low')
        page.select_option('#setting-difficulty','easy')
        page.fill('#setting-ftp','250')
        page.check('#setting-fps')
        page.click('#save-settings')
        check('Settings dialog saves and closes',page.locator('#modal').is_hidden())
        page.click('#help-btn')
        check('Help explicitly distinguishes physical and virtual stopping','stop physically' in page.locator('#modal-content').inner_text())
        page.keyboard.press('Escape')
        page.select_option('#power-source','peloton')
        page.wait_for_timeout(100)
        check('Browser missing native service is explained','Android shell' in page.locator('#source-hint').inner_text())
        check('Missing sensor does not substitute demo',diag(page)['telemetry']['stale'] is True and diag(page)['telemetry']['watts']==0)
        page.select_option('#power-source','demo')
        page.wait_for_timeout(200)
        page.click('#practice-btn')
        page.wait_for_function('window.breakawayDiagnostics().phase==="racing"',timeout=5000)
        check('Solo countdown reaches active race',diag(page)['screen']=='hud')
        check('Demo telemetry is labeled and reaches the game',page.locator('#watts').inner_text()=='200' and 'DEMO' in page.locator('#sensor-status').inner_text())
        page.keyboard.press('ArrowLeft');page.wait_for_timeout(220)
        check('Keyboard steering changes simulation target',diag(page)['rider']['targetLane']==1)
        page.keyboard.press('ArrowRight');page.wait_for_timeout(220)
        check('Opposite steering returns one lane',diag(page)['rider']['targetLane']==2)
        page.keyboard.press('b');page.wait_for_timeout(100)
        check('Boost spends stamina',diag(page)['rider']['energy']<65)
        page.keyboard.press('c');page.wait_for_timeout(120)
        check('Coast command reaches simulation',diag(page)['rider']['coast'] is True)
        page.keyboard.press('r');page.wait_for_timeout(120)
        check('Resume command restores propulsion',diag(page)['rider']['coast'] is False)
        page.click('#pause-btn')
        check('Pause opens solo pause dialog','BREATHER' in page.locator('#modal-title').inner_text())
        page.click('#resume-btn')
        screenshot(page,'race-desktop.png')
        check('Eight riders are rendered in standings',page.locator('.standing').count()==8)
        check('Canvas has a real pixel surface',page.evaluate('document.querySelector("canvas").width')>=480)
        page.click('#pause-btn');page.click('#quit-btn')
        check('Leaving solo returns to garage',diag(page)['screen']=='home')
        page.close()
        for width,height in [(390,844),(1024,600),(1920,1080)]:
            page=load(browser,{'width':width,'height':height})
            check(f'Viewport {width}x{height}: no horizontal page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
            page.locator('#practice-btn').scroll_into_view_if_needed()
            check(f'Viewport {width}x{height}: primary control clickable',page.locator('#practice-btn').is_visible())
            screenshot(page,f'home-{width}x{height}.png')
            if width==390:
                page.click('#settings-btn');check('Mobile settings dialog accessible',page.locator('#save-settings').is_visible());page.keyboard.press('Escape')
            page.close()
        # Synthetic native bridge events: checks integration semantics, not microphone hardware.
        native='''window.BreakawayBridge={getServerUrl:()=>'',isDebug:()=>true,reportCapabilities:()=>{},startSensors:()=>{},stopSensors:()=>{},setServerUrl:()=>{},startVoice:(allow)=>{window.lastOnlineConsent=allow;window.dispatchEvent(new CustomEvent('breakaway-voice',{detail:{type:'status',state:'listening',message:'Synthetic offline recognizer'}}));},stopVoice:()=>{}};'''
        page=load(browser,prelude=native)
        check('Native boot chooses real sensors rather than demo',diag(page)['telemetry']['source']=='peloton-v1' and diag(page)['telemetry']['stale'])
        page.evaluate("window.injectBike=setInterval(()=>window.dispatchEvent(new CustomEvent('breakaway-bike',{detail:{type:'telemetry',watts:215,cadence:88,resistance:43,source:'peloton-v1'}})),150)")
        page.wait_for_timeout(200)
        check('Valid native frame enables telemetry',diag(page)['telemetry']['watts']==215 and not diag(page)['telemetry']['stale'])
        page.click('#practice-btn');page.wait_for_function('window.breakawayDiagnostics().phase==="racing"',timeout=5000)
        page.click('#voice-btn');check('Native online speech default is opt-out',not page.locator('#voice-online').is_checked());page.click('#start-voice')
        check('Native voice started without online consent',page.evaluate('window.lastOnlineConsent') is False)
        def utterance(text,confidence,identifier,final=True):
            page.evaluate("d=>window.dispatchEvent(new CustomEvent('breakaway-voice',{detail:d}))",{'type':'result','text':text,'confidence':confidence,'utteranceId':identifier,'final':final})
            page.wait_for_timeout(120)
        utterance('left',.1,'low')
        check('Low-confidence native command is ignored',diag(page)['rider']['targetLane']==2)
        utterance('left',.95,'good')
        check('Native voice steers actual simulation',diag(page)['rider']['targetLane']==1)
        page.wait_for_timeout(400);utterance('left',.95,'good')
        check('Repeated final native result is de-duplicated',diag(page)['rider']['targetLane']==1)
        utterance('right',.95,'partial',False)
        check('Native interim result cannot steer',diag(page)['rider']['targetLane']==1)
        utterance('coast',.95,'coast')
        check('Voice coast reaches simulation',diag(page)['rider']['coast'] is True)
        page.evaluate('clearInterval(window.injectBike)');page.wait_for_timeout(2700)
        check('Lost native stream becomes stale and zero power',diag(page)['telemetry']['stale'] and diag(page)['rider']['watts']==0)
        page.evaluate("window.dispatchEvent(new CustomEvent('breakaway-voice',{detail:{type:'status',state:'denied',message:'Fixture permission denial'}}))")
        check('Microphone denial is visible and controls remain','ENABLE VOICE' in page.locator('#voice-label').inner_text())
        page.close()
        # Accelerated *test clock*, no state manipulation. Exercise a complete race and results flow.
        fast="let virtual=performance.now();window.requestAnimationFrame=cb=>setTimeout(()=>{virtual+=150;cb(virtual);},0);"
        page=load(browser,{'width':800,'height':600},prelude=fast)
        page.click('#settings-btn');page.select_option('#setting-quality','low');page.select_option('#setting-difficulty','easy');page.click('#save-settings')
        page.click('#practice-btn')
        page.locator('#demo-watts').fill('600');page.locator('#demo-watts').dispatch_event('input')
        page.wait_for_function('window.breakawayDiagnostics().screen==="results"',timeout=45000)
        check('Complete rendered solo race reaches results',page.locator('.result-row').count()==8)
        check('Career XP is awarded in results','XP' in page.locator('#career-summary').inner_text())
        screenshot(page,'results-complete-race.png')
        page.click('#again-btn')
        check('Play again starts a new race',diag(page)['screen']=='hud')
        page.close();browser.close()
    check('No uncaught JavaScript errors',not errors)
    report={'test':'bundled browser UI and synthetic native event integration','checksPassed':len(checks),'elapsedSeconds':round(time.monotonic()-start,2),'checks':checks,'uncaughtErrors':errors,'limitations':['No actual microphone input or physical Peloton was used.','Native bridge events were synthetic.','Complete-race test used an accelerated animation clock.','HTTP/SSE transport is independently integration-tested against the actual Node server.']}
    (ARTIFACTS/'browser-test.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__':main()
