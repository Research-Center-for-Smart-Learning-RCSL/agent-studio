# Music and sound

Three piano pieces play in a loop on every page; the player lives in the app layout, so moving between pages does not interrupt it. Every page also has click and dialog sounds, and a sound panel (the note button at the lower right) that sets the volume, turns the music off, and turns the effects off. The choice is kept per browser in `localStorage` under `agent-studio:audio`. Browsers refuse sound until the page has been touched once, so playback starts at the first click or key press.

The recordings are in `public/music/`, converted from the originals to 96 kbps stereo mp3 with metadata removed. Leading and trailing silence (below -50 dB) is trimmed, with a 20 ms fade in and a 150 ms fade out, and the three are normalized to the same integrated loudness (about -20 LUFS, true peak under -2 dBFS, two-pass `loudnorm`), so the volume does not jump from one piece to the next. All three come from Musopen and carry no attribution requirement.

| File | Piece | Original file | Licence |
|---|---|---|---|
| `gymnopedie-1.mp3` | Satie, Gymnopédie No. 1 (Robin Alciatore) | Wikimedia Commons, "Erik Satie - gymnopedies - la 1 ere. lent et douloureux.ogg" | Public domain |
| `nocturne-op9-no2.mp3` | Chopin, Nocturne Op. 9 No. 2 | Internet Archive item `musopen-chopin`, "Nocturne Op. 9 no. 2 in E flat major.ogg" | CC0 |
| `nocturne-op55-no2.mp3` | Chopin, Nocturne Op. 55 No. 2 | Internet Archive item `musopen-chopin`, "Nocturne Op. 55 no. 2 in E flat major.ogg" | CC0 |

The effects (buttons, links and row opens, switches and checkboxes, menu and tab choices, dialogs and drawers opening and closing, success and error notices, and the robot chirp) are synthesized with the Web Audio API in `src/lib/sfx.ts`, so no audio files or licences are involved.
