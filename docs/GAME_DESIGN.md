# Game design and tuning

## Experience

A complete short-session arcade loop: select a course and power source, join a grid, race and fight for position, cross the line, review results, gain local XP, and rematch. The player is a cyclist; pedaling is propulsion and short voice phrases are maneuvers. The visual language uses projected road strips, changing horizons, original vector cyclists and scenery, and a restrained neon/sunset palette. It evokes classic road-combat racers without distributing their assets.

## Courses

| Course | Length | Character |
| --- | --- | --- |
| Pacific Overdrive | 3.2 km | Coastal sunset, palms, flowing curves |
| Redline Canyon | 3.6 km | Desert scenery and technical turns |
| Neon Afterhours | 3.0 km | Night-city colors and fast pacing |
| Summit Radio | 4.0 km | Pines, mountains and endurance-length racing |

Distances are virtual game distances, not a validated estimate of real road travel. Procedural object placement is seeded and repeatable for a given course definition. Object contact is resolved by the simulation, not by canvas hit-testing.

## Racing

Five lanes provide discrete voice steering. A command changes the target lane once, while the avatar moves smoothly toward it. Power produces a capped cube-root-based target speed with game-tuned acceleration, braking, hills and drafting. This is an arcade model, not an engineering simulation of a bicycle or a fitness prescription. Cadence animates the rider; measured watts are the propulsion input.

Absolute mode uses watts directly. Equalized mode scales watts relative to each player's chosen baseline, normalized to 200 W. Baselines are self-reported; equalized mode is suitable for accessible friendly racing, not verified competition. Demo and physical sources are visibly distinguished.

Drafting applies when another rider is 2–15 virtual meters ahead in the same lane. It modestly increases target speed and accelerates stamina regeneration. Close same-lane contact prevents a faster cyclist from simply driving through a slower one. A lane change creates passing space.

## Combat and resources

| Action | Main rule |
| --- | --- |
| Hit | 17 armor damage, roughly 7 m reach and adjacent-lane restriction; 0.85 s cooldown |
| Kick | 24 damage, stronger speed penalty and a lane push; 1.25 s cooldown |
| Chain pickup | 20 s equipment duration, 10 m reach, 25-damage hits |
| Block | Costs 12 stamina; 1.4 s shield, 2.2 s cooldown; parries attacks or absorbs one hazard |
| Boost | Costs 28 stamina; 2.6 s burst with 4.2 s cooldown; requires live positive power |
| Crash | Armor depletion causes a short recovery and speed loss, not permanent elimination |

Stamina regenerates while riding, recovers more rapidly in a draft and during coasting, and is capped at 100. Armor also slowly recovers when not stunned. Pickups restore armor, replenish stamina or equip the chain. Barriers and oil penalize careless lines. Pickups are available once per rider so network packet ordering does not turn simultaneous contact into arbitrary item ownership disputes.

AI riders use the same action functions, cooldowns and simulation. They vary effort, avoid nearby hazards, move toward useful pickups/drafts, and choose attacks, blocks and boosts. Three difficulty presets change AI power ranges; they are not adaptive coaching.

## Race flow

A three-second countdown precedes motion. Private rooms require each human rider to ready; the host starts. Quick Race starts automatically after ten seconds and fills remaining seats with bots. Eight total riders are supported. Spectators watch the current leading rider and cannot send rider inputs.

All human riders finishing/withdrawing ends a race. A finite race timeout handles stalled races, and a 45-second grace window after the first human finishes prevents one coasting participant from holding everyone indefinitely. Finishes use within-tick interpolation for stable ordering. A disconnected participant becomes DNF after the server's reconnect grace; remaining competitors continue.

Results include position, finish time, mean watts, hits, crashes and virtual energy/distance. Local progress awards XP, achievements and jersey unlocks. Re-presenting the same race ID does not award XP again. Personal records distinguish telemetry source and power-balancing mode. Server times exclude demo results and are labeled unverified.

## Accessibility and riding constraints

Menus have focus indicators, labeled controls and a trapped-focus dialog. The interface supports touch, keyboard, gamepad and voice rather than requiring voice for basic access. Reduced-motion mode suppresses camera shake; rendering resolution and audio level can be reduced. Actual arm's-length readability and physical ergonomics still require on-bike testing.

There is no physical resistance automation, virtual-to-physical crash feedback, real emergency-stop promise, microphone recording archive, voice chat or incentive to exceed a safe personal effort. The user must rely on the bike's controls for physical stopping.

## Scope that is not implemented

There is no story campaign, ranked season, verified power attestation, account synchronization, user-generated course editor, user billing, geographic region routing, rollback combat, or live server-room migration. Those are potential product extensions, not hidden claims of feature completeness. The implemented feature boundary is the complete arcade race loop described above.
