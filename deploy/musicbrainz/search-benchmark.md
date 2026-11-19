# Music search benchmark

The opt-in Go test ran against the production MusicBrainz replica using one connection.
It timed the Go-to-PostgreSQL search path, including spelling correction and ranking.
The baseline ran from commit `8430fe9` before the additive backfill.
The first pass left shared PostgreSQL and operating-system caches intact. The warm
pass immediately repeated the same queries. The first pass measures first-touch
latency on the running replica, with no guarantee that pages were cold.
The final first pass followed an earlier trial on the same replica, so a true
cold-cache p95 remains unverified. The earlier trial measured 630 ms first-pass
p95 immediately after index maintenance.

The baseline timed out on two queries in each pass. The new path returned results
for all 28 queries in both passes and passed all 26 checks for a specific first hit.
Identical display titles can represent distinct MusicBrainz recordings.

| Pass | Baseline p95 | New p95 |
| --- | ---: | ---: |
| First | 8.001s | 95ms |
| Warm | 8.001s | 87ms |

| Query | Baseline first | Baseline warm | New first | New warm | New warm first result |
| --- | ---: | ---: | ---: | ---: | --- |
| bohemian rhapsody | 697ms | 503ms | 40ms | 15ms | track Bohemian Rhapsody — Queen |
| bohemian rapsody | 560ms | 513ms | 28ms | 26ms | track Bohemian Rhapsody — Queen |
| smells like teen spirt | 384ms | 344ms | 59ms | 60ms | track Smells Like Teen Spirit — Nirvana |
| taylor swift | 482ms | 439ms | 30ms | 30ms | artist Taylor Swift |
| taylr swft | 984ms | 919ms | 112ms | 100ms | artist Taylor Swift |
| taylor swi | 495ms | 454ms | 75ms | 74ms | artist Taylor Swift |
| kendrick humble | 426ms | 394ms | 34ms | 33ms | track HUMBLE. — Kendrick Lamar |
| kendrik lamr | 266ms | 210ms | 35ms | 34ms | artist Kendrick Lamar |
| billie eilish bad guy | 2.559s | 2.321s | 51ms | 50ms | track bad guy — Billie Eilish |
| billie eil | 1.406s | 1.359s | 31ms | 28ms | artist Billie Eilish |
| fleetwod mac dreams | 342ms | 307ms | 39ms | 38ms | track Dreams — Fleetwood Mac |
| fleetwood mac | 482ms | 401ms | 47ms | 47ms | artist Fleetwood Mac |
| beyonse | 690ms | 537ms | 92ms | 82ms | artist Beyoncé |
| metalica | 972ms | 766ms | 35ms | 34ms | artist Metallica |
| coldpaly yellow | 878ms | 696ms | 17ms | 17ms | track Yellow — Coldplay |
| drake | 1.452s | 1.2s | 30ms | 31ms | artist Drake |
| the beatles | 1.555s | 1.354s | 69ms | 67ms | artist The Beatles |
| love | 2.444s | 2.352s | 67ms | 58ms | artist Prince |
| the | 8.001s (timeout) | 8.001s (timeout) | 46ms | 43ms | artist The Beatles |
| queen | 858ms | 790ms | 94ms | 86ms | artist Queen |
| adele hello | 1.476s | 1.345s | 37ms | 34ms | track Hello — Adele |
| ac dc back in black | 8.001s (timeout) | 8.001s (timeout) | 95ms | 87ms | track Back in Black — AC/DC |
| acdc | 26ms | 2ms | 77ms | 77ms | artist AC/DC |
| 宇多田ヒカル First Love | 44ms | 45ms | 27ms | 27ms | track First Love — 宇多田ヒカル |
| sigur ros | 1.448s | 1.328s | 34ms | 33ms | artist Sigur Rós |
| beyoncé | 767ms | 728ms | 27ms | 23ms | artist Beyoncé |
| hey jude | 61ms | 13ms | 33ms | 33ms | track Hey Jude — The Beatles |
| radiohead creep | 738ms | 664ms | 21ms | 20ms | track Creep — Radiohead |

The warm pass was slower for `acdc` (2 ms to 77 ms) and `hey jude`
(13 ms to 33 ms).

## Production database additions

- `jedflix.search_documents.release_count`, populated from recording appearances, releases per release group, and releases per artist credit.
- `jedflix.search_documents_release_pop_idx`, the popularity-ordering B-tree.
- `jedflix.search_terms`, with about 398,000 terms, plus `search_terms_pkey` and `search_terms_trgm_idx`.
- `search_release_popularity=1` and `search_term_dictionary=1` in `jedflix.search_state`.

## Baseline output

```text
=== RUN   TestMusicSearchBenchmark
    search_benchmark_test.go:56: first | bohemian rhapsody | 697ms | track Bohemian Rhapsody — Queen / album Bohemian Rhapsody — Queen / track Bohemian Rhapsody — Queen, The Muppets
    search_benchmark_test.go:56: first | bohemian rapsody | 560ms | track Bohemian Rapsody — IANI / track Bohemian Rapsody — Gold, Frankincense & Disk Drive / track Bohemian Rhapsody — Queen
    search_benchmark_test.go:56: first | smells like teen spirt | 384ms | track Smells Like Teen Spirit — Nirvana / track Dancing With the One‐Legged… — Marilyn Manson / track [unknown] — Marilyn Manson
    search_benchmark_test.go:56: first | taylor swift | 482ms | artist Taylor Swift / album Taylor Swift — Taylor Swift / track Taylor Swift — Walker Hayes
    search_benchmark_test.go:56: first | taylr swft | 984ms | artist Taylor Swift / album 1989 — Taylor Swift / album folklore — Taylor Swift
    search_benchmark_test.go:56: first | taylor swi | 495ms | artist Taylor Swift / album Taylor Swift — Taylor Swift / album 1989 — Taylor Swift
    search_benchmark_test.go:56: first | kendrick humble | 426ms | track HUMBLE. — Kendrick Lamar / album HUMBLE. — Kendrick Lamar / track HUMBLE. — Kendrick Lamar
    search_benchmark_test.go:56: first | kendrik lamr | 266ms | album good kid, m.A.A.d city — Kendrick Lamar / album To Pimp a Butterfly — Kendrick Lamar / album DAMN. — Kendrick Lamar
    search_benchmark_test.go:56: first | billie eilish bad guy | 2.559s | track bad guy — Billie Eilish / album bad guy — Billie Eilish, Justin Bieber / track bad guy — Billie Eilish
    search_benchmark_test.go:56: first | billie eil | 1.406s | artist Billie Eilish / album WHEN WE ALL FALL ASLEEP, WHERE DO WE GO? — Billie Eilish / track bad guy — Billie Eilish
    search_benchmark_test.go:56: first | fleetwod mac dreams | 342ms | album Rumours — Fleetwood Mac / track Dreams — Fleetwood Mac / track Don’t Stop — Fleetwood Mac
    search_benchmark_test.go:56: first | fleetwood mac | 482ms | artist Fleetwood Mac / album Fleetwood Mac — Fleetwood Mac / track Fleetwood Mac — Fleetwood Mac
    search_benchmark_test.go:56: first | beyonse | 690ms | artist Beyoncé / album Far Beyond Driven — Pantera / album Electric Ladyland — The Jimi Hendrix Experience
    search_benchmark_test.go:56: first | metalica | 972ms | album Master of Puppets — Metallica / artist Metallica / album …And Justice for All — Metallica
    search_benchmark_test.go:56: first | coldpaly yellow | 878ms | artist Coldplay / album A Rush of Blood to the Head — Coldplay / album Parachutes — Coldplay
    search_benchmark_test.go:56: first | drake | 1.452s | artist Drake / album Drake — simodmart / track Drake — Afro Celt Sound System
    search_benchmark_test.go:56: first | the beatles | 1.555s | artist The Beatles / album The Beatles — The Beatles / album The Beatles — The Beatles
    search_benchmark_test.go:56: first | love | 2.444s | track Love Is All Around — Wet Wet Wet / track Love Is a Battlefield — Pat Benatar / track Love Theme — Vangelis
    search_benchmark_test.go:45: first | the | 8.001s | ERROR music catalog fetch failed: text search: ERROR: canceling statement due to statement timeout (SQLSTATE 57014)
    search_benchmark_test.go:56: first | queen | 858ms | track Queen of Hearts — Juice Newton / track Queen of the Reich — Queensrÿche / album Queen of the Clouds — Tove Lo
    search_benchmark_test.go:56: first | adele hello | 1.476s | track Hello — Adele / track Hello (Adele Cover) — Cole Rolland, Lauren Babic, Zackary David / track Say Hello to Adele — Joyner Lucas
    search_benchmark_test.go:45: first | ac dc back in black | 8.001s | ERROR music catalog fetch failed: text search: ERROR: canceling statement due to statement timeout (SQLSTATE 57014)
    search_benchmark_test.go:56: first | acdc | 26ms | artist AC/DC / track 3‐11 Japan (Deep Purple vs. ACDC vs. QOTSA vs. Johnny Cash vs. Pearl Jam vs. Blondie) — MadMixMustang / album Mashup Series 2 + Some Old Stuff — Joviator, ACDC
    search_benchmark_test.go:56: first | 宇多田ヒカル First Love | 44ms | track First Love — 宇多田ヒカル / track First Love (2022 Mix) — 宇多田ヒカル / album First Love — 宇多田ヒカル
    search_benchmark_test.go:56: first | sigur ros | 1.448s | album Ágætis byrjun — Sigur Rós / artist Sigur Rós / album Takk… — Sigur Rós
    search_benchmark_test.go:56: first | beyoncé | 767ms | artist Beyoncé / album BEYONCÉ — Beyoncé / album BEYONCÉ — Beyoncé
    search_benchmark_test.go:56: first | hey jude | 61ms | track Hey Jude — The Beatles / album Hey Jude — The Beatles / track Hey Jude — The Beatles
    search_benchmark_test.go:56: first | radiohead creep | 738ms | track Creep — Radiohead / track Creep (acoustic) — Radiohead / album Creep — Radiohead
    search_benchmark_test.go:59: first p95 | 8.001s
    search_benchmark_test.go:56: warm | bohemian rhapsody | 503ms | track Bohemian Rhapsody — Queen / album Bohemian Rhapsody — Queen / track Bohemian Rhapsody — Queen, The Muppets
    search_benchmark_test.go:56: warm | bohemian rapsody | 513ms | track Bohemian Rapsody — IANI / track Bohemian Rapsody — Gold, Frankincense & Disk Drive / track Bohemian Rhapsody — Queen
    search_benchmark_test.go:56: warm | smells like teen spirt | 344ms | track Smells Like Teen Spirit — Nirvana / track Dancing With the One‐Legged… — Marilyn Manson / track [unknown] — Marilyn Manson
    search_benchmark_test.go:56: warm | taylor swift | 439ms | artist Taylor Swift / album Taylor Swift — Taylor Swift / track Taylor Swift — Walker Hayes
    search_benchmark_test.go:56: warm | taylr swft | 919ms | artist Taylor Swift / album 1989 — Taylor Swift / album folklore — Taylor Swift
    search_benchmark_test.go:56: warm | taylor swi | 454ms | artist Taylor Swift / album Taylor Swift — Taylor Swift / album 1989 — Taylor Swift
    search_benchmark_test.go:56: warm | kendrick humble | 394ms | track HUMBLE. — Kendrick Lamar / album HUMBLE. — Kendrick Lamar / track HUMBLE. — Kendrick Lamar
    search_benchmark_test.go:56: warm | kendrik lamr | 210ms | album good kid, m.A.A.d city — Kendrick Lamar / album To Pimp a Butterfly — Kendrick Lamar / album DAMN. — Kendrick Lamar
    search_benchmark_test.go:56: warm | billie eilish bad guy | 2.321s | track bad guy — Billie Eilish / album bad guy — Billie Eilish, Justin Bieber / track bad guy — Billie Eilish
    search_benchmark_test.go:56: warm | billie eil | 1.359s | artist Billie Eilish / album WHEN WE ALL FALL ASLEEP, WHERE DO WE GO? — Billie Eilish / track bad guy — Billie Eilish
    search_benchmark_test.go:56: warm | fleetwod mac dreams | 307ms | album Rumours — Fleetwood Mac / track Dreams — Fleetwood Mac / track Don’t Stop — Fleetwood Mac
    search_benchmark_test.go:56: warm | fleetwood mac | 401ms | artist Fleetwood Mac / album Fleetwood Mac — Fleetwood Mac / track Fleetwood Mac — Fleetwood Mac
    search_benchmark_test.go:56: warm | beyonse | 537ms | artist Beyoncé / album Far Beyond Driven — Pantera / album Electric Ladyland — The Jimi Hendrix Experience
    search_benchmark_test.go:56: warm | metalica | 766ms | album Master of Puppets — Metallica / artist Metallica / album …And Justice for All — Metallica
    search_benchmark_test.go:56: warm | coldpaly yellow | 696ms | artist Coldplay / album A Rush of Blood to the Head — Coldplay / album Parachutes — Coldplay
    search_benchmark_test.go:56: warm | drake | 1.2s | artist Drake / album Drake — simodmart / track Drake — Afro Celt Sound System
    search_benchmark_test.go:56: warm | the beatles | 1.354s | artist The Beatles / album The Beatles — The Beatles / album The Beatles — The Beatles
    search_benchmark_test.go:56: warm | love | 2.352s | track Love Is All Around — Wet Wet Wet / track Love Is a Battlefield — Pat Benatar / track Love Theme — Vangelis
    search_benchmark_test.go:45: warm | the | 8.001s | ERROR music catalog fetch failed: text search: ERROR: canceling statement due to statement timeout (SQLSTATE 57014)
    search_benchmark_test.go:56: warm | queen | 790ms | track Queen of Hearts — Juice Newton / track Queen of the Reich — Queensrÿche / album Queen of the Clouds — Tove Lo
    search_benchmark_test.go:56: warm | adele hello | 1.345s | track Hello — Adele / track Hello (Adele Cover) — Cole Rolland, Lauren Babic, Zackary David / track Say Hello to Adele — Joyner Lucas
    search_benchmark_test.go:45: warm | ac dc back in black | 8.001s | ERROR music catalog fetch failed: text search: ERROR: canceling statement due to statement timeout (SQLSTATE 57014)
    search_benchmark_test.go:56: warm | acdc | 2ms | artist AC/DC / track 3‐11 Japan (Deep Purple vs. ACDC vs. QOTSA vs. Johnny Cash vs. Pearl Jam vs. Blondie) — MadMixMustang / album Mashup Series 2 + Some Old Stuff — Joviator, ACDC
    search_benchmark_test.go:56: warm | 宇多田ヒカル First Love | 45ms | track First Love — 宇多田ヒカル / track First Love (2022 Mix) — 宇多田ヒカル / album First Love — 宇多田ヒカル
    search_benchmark_test.go:56: warm | sigur ros | 1.328s | album Ágætis byrjun — Sigur Rós / artist Sigur Rós / album Takk… — Sigur Rós
    search_benchmark_test.go:56: warm | beyoncé | 728ms | artist Beyoncé / album BEYONCÉ — Beyoncé / album BEYONCÉ — Beyoncé
    search_benchmark_test.go:56: warm | hey jude | 13ms | track Hey Jude — The Beatles / album Hey Jude — The Beatles / track Hey Jude — The Beatles
    search_benchmark_test.go:56: warm | radiohead creep | 664ms | track Creep — Radiohead / track Creep (acoustic) — Radiohead / album Creep — Radiohead
    search_benchmark_test.go:59: warm p95 | 8.001s
--- PASS: TestMusicSearchBenchmark (74.49s)
PASS
```

## New search output

```text
=== RUN   TestMusicSearchBenchmark
    search_benchmark_test.go:83: first | bohemian rhapsody | 40ms | track Bohemian Rhapsody — Queen / track Bohemian Rhapsody — Queen / track Bohemian Rhapsody — Queen
    search_benchmark_test.go:83: first | bohemian rapsody | 28ms | track Bohemian Rhapsody — Queen / track Bohemian Rapsody — IANI / track Bohemian Rapsody — Gold, Frankincense & Disk Drive
    search_benchmark_test.go:83: first | smells like teen spirt | 59ms | track Smells Like Teen Spirit — Nirvana / track Smells Like Teen Spirit — Tori Amos / track Smells Like Teen Spirit (Boombox Rehearsals) — Nirvana
    search_benchmark_test.go:83: first | taylor swift | 30ms | artist Taylor Swift / album Taylor Swift — Taylor Swift / track Taylor Swift — Walker Hayes
    search_benchmark_test.go:83: first | taylr swft | 112ms | artist Taylor Swift / album Taylor Swift — Taylor Swift / artist James Taylor
    search_benchmark_test.go:83: first | taylor swi | 75ms | artist Taylor Swift / album Taylor Swift — Taylor Swift / track Love Story — Taylor Swift
    search_benchmark_test.go:83: first | kendrick humble | 34ms | track HUMBLE. — Kendrick Lamar / track HUMBLE. — Kendrick Lamar / track HUMBLE (Skrillex remix) — Kendrick Lamar
    search_benchmark_test.go:83: first | kendrik lamr | 35ms | artist Kendrick Lamar / track Don’t Wanna Know — Maroon 5, Kendrick Lamar / track Money Trees — Kendrick Lamar, Jay Rock
    search_benchmark_test.go:83: first | billie eilish bad guy | 51ms | track bad guy — Billie Eilish / track bad guy — Billie Eilish, Justin Bieber / album bad guy — Billie Eilish
    search_benchmark_test.go:83: first | billie eil | 31ms | artist Billie Eilish / track bad guy — Billie Eilish / track when the party’s over — Billie Eilish
    search_benchmark_test.go:83: first | fleetwod mac dreams | 39ms | track Dreams — Fleetwood Mac / track Dreams (take 2) — Fleetwood Mac / track Dreams — Fleetwood Mac
    search_benchmark_test.go:83: first | fleetwood mac | 47ms | artist Fleetwood Mac / album Fleetwood Mac — Fleetwood Mac / track Fleetwood Mac — Fleetwood Mac
    search_benchmark_test.go:83: first | beyonse | 92ms | artist Beyoncé / artist Above & Beyond / artist BTS
    search_benchmark_test.go:83: first | metalica | 35ms | artist Metallica / album Metallica — Metallica / track Enter Sandman — Metallica
    search_benchmark_test.go:83: first | coldpaly yellow | 17ms | track Yellow — Coldplay / track Yellow — Coldplay / album Yellow — Coldplay
    search_benchmark_test.go:83: first | drake | 30ms | artist Drake / artist Drake / artist Hamid Drake
    search_benchmark_test.go:83: first | the beatles | 69ms | artist The Beatles / artist The Beatles / album The Beatles — The Beatles
    search_benchmark_test.go:83: first | love | 67ms | artist Prince / track Lovefool — The Cardigans / track LoveGame — Lady Gaga
    search_benchmark_test.go:83: first | the | 46ms | artist The Beatles / artist The Rolling Stones / artist Wolfgang Amadeus Mozart
    search_benchmark_test.go:83: first | queen | 94ms | artist Queen / artist Queens of the Stone Age / artist Queensrÿche
    search_benchmark_test.go:83: first | adele hello | 37ms | track Hello — Adele / album Hello — Adele / track Say Hello to Adele — Joyner Lucas
    search_benchmark_test.go:83: first | ac dc back in black | 95ms | track Back in Black — AC/DC / album Back in Black — AC/DC / track Back in Black — AC/DC
    search_benchmark_test.go:83: first | acdc | 77ms | artist AC/DC / track AC/DC — The Sweet / track AC/DC — The Sweet
    search_benchmark_test.go:83: first | 宇多田ヒカル First Love | 27ms | track First Love — 宇多田ヒカル / track First Love (2022 Mix) — 宇多田ヒカル / track time will tell — 宇多田ヒカル
    search_benchmark_test.go:83: first | sigur ros | 34ms | artist Sigur Rós / track Sigur Rós — Sigur Rós / track Hoppípolla — Sigur Rós
    search_benchmark_test.go:83: first | beyoncé | 27ms | artist Beyoncé / album BEYONCÉ — Beyoncé / track Telephone — Lady Gaga, Beyoncé
    search_benchmark_test.go:83: first | hey jude | 33ms | track Hey Jude — The Beatles / track Hey Jude — The Beatles / track Hey Jude — The Beatles
    search_benchmark_test.go:83: first | radiohead creep | 21ms | track Creep — Radiohead / track Creep — Radiohead / track Creep (acoustic) — Radiohead
    search_benchmark_test.go:89: first p95 | 95ms
    search_benchmark_test.go:83: warm | bohemian rhapsody | 15ms | track Bohemian Rhapsody — Queen / track Bohemian Rhapsody — Queen / track Bohemian Rhapsody — Queen
    search_benchmark_test.go:83: warm | bohemian rapsody | 26ms | track Bohemian Rhapsody — Queen / track Bohemian Rapsody — IANI / track Bohemian Rapsody — Gold, Frankincense & Disk Drive
    search_benchmark_test.go:83: warm | smells like teen spirt | 60ms | track Smells Like Teen Spirit — Nirvana / track Smells Like Teen Spirit — Tori Amos / track Smells Like Teen Spirit (Boombox Rehearsals) — Nirvana
    search_benchmark_test.go:83: warm | taylor swift | 30ms | artist Taylor Swift / album Taylor Swift — Taylor Swift / track Taylor Swift — Walker Hayes
    search_benchmark_test.go:83: warm | taylr swft | 100ms | artist Taylor Swift / album Taylor Swift — Taylor Swift / artist James Taylor
    search_benchmark_test.go:83: warm | taylor swi | 74ms | artist Taylor Swift / album Taylor Swift — Taylor Swift / track Love Story — Taylor Swift
    search_benchmark_test.go:83: warm | kendrick humble | 33ms | track HUMBLE. — Kendrick Lamar / track HUMBLE. — Kendrick Lamar / track HUMBLE (Skrillex remix) — Kendrick Lamar
    search_benchmark_test.go:83: warm | kendrik lamr | 34ms | artist Kendrick Lamar / track Don’t Wanna Know — Maroon 5, Kendrick Lamar / track Money Trees — Kendrick Lamar, Jay Rock
    search_benchmark_test.go:83: warm | billie eilish bad guy | 50ms | track bad guy — Billie Eilish / track bad guy — Billie Eilish, Justin Bieber / album bad guy — Billie Eilish
    search_benchmark_test.go:83: warm | billie eil | 28ms | artist Billie Eilish / track bad guy — Billie Eilish / track when the party’s over — Billie Eilish
    search_benchmark_test.go:83: warm | fleetwod mac dreams | 38ms | track Dreams — Fleetwood Mac / track Dreams (take 2) — Fleetwood Mac / track Dreams — Fleetwood Mac
    search_benchmark_test.go:83: warm | fleetwood mac | 47ms | artist Fleetwood Mac / album Fleetwood Mac — Fleetwood Mac / track Fleetwood Mac — Fleetwood Mac
    search_benchmark_test.go:83: warm | beyonse | 82ms | artist Beyoncé / artist Above & Beyond / artist BTS
    search_benchmark_test.go:83: warm | metalica | 34ms | artist Metallica / album Metallica — Metallica / track Enter Sandman — Metallica
    search_benchmark_test.go:83: warm | coldpaly yellow | 17ms | track Yellow — Coldplay / track Yellow — Coldplay / album Yellow — Coldplay
    search_benchmark_test.go:83: warm | drake | 31ms | artist Drake / artist Drake / artist Hamid Drake
    search_benchmark_test.go:83: warm | the beatles | 67ms | artist The Beatles / artist The Beatles / album The Beatles — The Beatles
    search_benchmark_test.go:83: warm | love | 58ms | artist Prince / track Lovefool — The Cardigans / track LoveGame — Lady Gaga
    search_benchmark_test.go:83: warm | the | 43ms | artist The Beatles / artist The Rolling Stones / artist Wolfgang Amadeus Mozart
    search_benchmark_test.go:83: warm | queen | 86ms | artist Queen / artist Queens of the Stone Age / artist Queensrÿche
    search_benchmark_test.go:83: warm | adele hello | 34ms | track Hello — Adele / album Hello — Adele / track Say Hello to Adele — Joyner Lucas
    search_benchmark_test.go:83: warm | ac dc back in black | 87ms | track Back in Black — AC/DC / album Back in Black — AC/DC / track Back in Black — AC/DC
    search_benchmark_test.go:83: warm | acdc | 77ms | artist AC/DC / track AC/DC — The Sweet / track AC/DC — The Sweet
    search_benchmark_test.go:83: warm | 宇多田ヒカル First Love | 27ms | track First Love — 宇多田ヒカル / track First Love (2022 Mix) — 宇多田ヒカル / track time will tell — 宇多田ヒカル
    search_benchmark_test.go:83: warm | sigur ros | 33ms | artist Sigur Rós / track Sigur Rós — Sigur Rós / track Hoppípolla — Sigur Rós
    search_benchmark_test.go:83: warm | beyoncé | 23ms | artist Beyoncé / album BEYONCÉ — Beyoncé / track Telephone — Lady Gaga, Beyoncé
    search_benchmark_test.go:83: warm | hey jude | 33ms | track Hey Jude — The Beatles / track Hey Jude — The Beatles / track Hey Jude — The Beatles
    search_benchmark_test.go:83: warm | radiohead creep | 20ms | track Creep — Radiohead / track Creep — Radiohead / track Creep (acoustic) — Radiohead
    search_benchmark_test.go:89: warm p95 | 87ms
--- PASS: TestMusicSearchBenchmark (2.67s)
PASS
```
