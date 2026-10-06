# Class Quest

An 8-bit race view of your class's progress through a Canvas course. Each student gets
their own pixel robot, computer, or brick figure with their name above it. Every
**module is a level** with its own world (Green Hills, Sunset Dunes, Frost Peaks, Neon
Circuit, Lava Forge, Coral Deep, Star Station, Byte Castle). Every **required item in a
module is an obstacle**. When a student turns something in, their character runs forward
and jumps over the next obstacle.

**On the class display**

- **Race track:** everyone runs on the same track, so you can see at a glance how far
  each student is. A colored trail behind each character works like a progress bar. With
  a big class, the track splits into side-by-side columns so names stay readable. Two
  columns of 13 fit 25 students on a 1080p Boxlight or projector. Calm scenery (the
  default) tones down backgrounds so names and characters stand out.
- **Screens:** a separate display for each class period, small group, or any set of
  students you choose. Each one is ranked among its own students.
- **Student close-up:** click a lane (or turn on **Spotlight** to cycle automatically) to
  see that student's level, their checklist with due dates, their badges, and their
  whole journey.
- **Class goals:** a shared progress bar ("200 challenges → Pizza party") that everyone
  on the screen pushes forward, with a celebration when it's reached.
- **Pace marker:** a dashed line and a little ghost showing where the class should be,
  based on Canvas due dates.
- **Badges:** 13 badges, all of them celebratory. Nothing on the display shows late or
  missing work. Click **Badges** at the bottom of the display to see every badge, how to
  earn it, and who has it:
  - **Progress:** First Steps, Explorer, Halfway Hero, Champion, Trailblazer (first to
    clear a level), Pace Setter
  - **Habits:** On Fire (3 days this week, and the character gets a flame), Marathon,
    Speedrunner, Comeback
  - **Quality:** Early Bird, Clockwork, Perfectionist
- **Spotlight:** the badge case is the star. Earned badges are lit up (newly earned ones
  glow), and the rest show what's left to earn.
- **Extras:** level-up confetti, pop-ups, a news ticker, optional 8-bit sound effects,
  and a full-screen button.
- **Cooperative mode:** turns places off entirely if competition isn't right for your
  class.

**For you (Teacher controls at `/admin`)**

- **Screens:** check exactly which students appear, or start from Canvas sections. Every
  screen gets its own link.
- **Students:** set nicknames or privacy-friendly display names, and pick each student's
  character.
- **Levels:** choose which modules count and pick each level's world.
- **Badges:** turn any badge on or off, and see how many students have each one.
- **Display:** set the title, name style, race or cooperative mode, leaderboard, pace
  marker, sound and spotlight timing.
  - **Track layout:** shared race track (with automatic or fixed columns), or cards that
    show only the levels around each student.
  - **Scenery:** calm or detailed.
- **Insights (private):** who's behind pace, last time each student turned something in,
  missing and late counts, and a CSV export.

It runs on your own computer and only talks to your Canvas instance. Your Canvas token
stays on that computer. Displays never receive Canvas IDs, real names, or grades.

## Getting started (nothing to install)

You don't need npm, an installer, or admin rights.

1. **Download the zip for your computer** from this repository's
   [Releases](../../releases) page:
   - **Windows:** `ClassQuest-win-x64.zip`
   - **Mac with an Apple chip** (M1 or newer): `ClassQuest-mac-arm64.zip`
   - **Older Intel Mac:** `ClassQuest-mac-x64.zip`
   - **Linux:** `ClassQuest-linux-x64.zip`

   Each one includes the official Node.js program, so there's nothing else to get.
2. **Unzip it** somewhere you can write to, like Documents or the Desktop.
3. **Start it:**
   - **Windows:** double-click **Start Class Quest**. If Windows says it protected your
     PC, click **More info → Run anyway**.
   - **Mac:** the first time, right-click **Start Class Quest.command → Open → Open**.
     After that, you can just double-click it.
4. **Connect Canvas.** Your browser opens Teacher controls on the **Canvas** tab. Paste
   your Canvas address and a token, pick your course, and you're done. The tab explains
   how to get a token: in Canvas, go to **Account → Settings → + New Access Token**. Use
   an account that's a teacher or TA in the course.

Keep the Class Quest window open while you use it, and close it to stop. Until you
connect Canvas, the display shows a pretend class so you can try things out. To remove
Class Quest, delete the folder. Your settings and saved connection live in its `data`
folder.

**If your computer won't run it:** some school computers block programs from
downloaded folders. In that case, ask IT to allow the folder, or run Class Quest on
another computer on the school network with **Show on other devices** (below) and open
the display from your computer's browser. Chromebooks can't run it directly, but they
can open the display from another computer.

### Exporting assignment instructions

Two ways to save every assignment's instructions, rubric, due date and allowed file types
from your connected course into one document:

- **Teacher controls:** go to **Canvas → Download instructions** (Markdown or JSON).
- **Double-click:** run **Export Canvas instructions** in the Class Quest folder. It
  saves `instructions/instructions.md` and `instructions.json` and opens the folder. From
  source, run `node scripts/export-instructions.js`.

It reads course content only (assignments, rubrics, module pages and the syllabus),
never student names, submissions or grades, so the files are safe to share.

### Showing it on another device

On Windows, use **Show on other devices** instead of **Start Class Quest**. On Mac or
Linux, run the launcher with `--lan`. Then open the network address it prints on the
classroom TV or projector. Teacher controls then need a PIN:

- If you don't set one, a random PIN is printed when Class Quest starts.
- To choose your own, set `ADMIN_PIN` (or `"adminPin"` in `config.json`).

On the computer running Class Quest itself, teacher controls open without a PIN unless
you set one. Windows may ask whether to allow Node.js on the network. If you can't
approve that, the display will only work on the computer running Class Quest.

### Running from source (if you already have Node.js)

```sh
node server.js --open      # or: npm start
node server.js --demo      # always show the demo class
```

Instead of the Canvas tab, you can also set `CANVAS_URL`, `CANVAS_TOKEN` and
`CANVAS_COURSE_ID` as environment variables, or in a `config.json` copied from
`config.example.json`. Environment variables take priority and lock the Canvas tab.

### How progress is measured

Class Quest uses Canvas **module completion requirements** (Modules → ⋮ → Edit →
*Add requirement*: "must submit", "must view", "must score at least", and so on).

- **Levels:** published modules with at least one requirement, in course order. You can
  turn any of them off in **Levels**.
- **Obstacles:** the required items in each module.
- **Current level:** the first module the student hasn't completed. Their position inside
  that level is the share of its requirements they've met.
- **Place:** furthest along the track first, among the students on that screen. Ties
  share a place.
- **Pace:** just past the last required item whose due date has passed.
- **Badges:** each badge's description in the app says exactly how to earn it.
  - **Progress badges** come from module progress. Trailblazer goes to the first student
    to complete a module, and Pace Setter means 3 or more challenges ahead of the due
    dates.
  - **Habit and quality badges** come from the course's submissions. They use submission
    days, how early work was turned in, and whether it was late. Perfectionist compares
    scores to the assignment's points. Quizzes don't count toward Perfectionist.

Canvas is checked every `refreshSeconds` (60 by default, minimum 15), or right away with
**Refresh from Canvas** in teacher controls. Each refresh makes about one request per
student plus a few for the course. Requests run four at a time, and the app backs off
automatically if Canvas rate-limits it.

## Display links

Each screen's link is shown in teacher controls. You can add these to any display link:

| Parameter | Effect |
| --- | --- |
| `?view=period-3` | Show a specific screen (the plain address shows the default screen) |
| `&spotlight=20` | Spotlight a student every 20 seconds (`0` turns it off) |
| `&board=0` | Hide the leaderboard panel |
| `&columns=2` | Force the number of race-track columns on this display |
| `&layout=cards&before=1&after=2` | Use cards on this display, showing these levels around each student |
| `&scenery=detailed` | Full scenery on this display |
| `&sound=1` | Start with sound on (browsers may still need one click first) |

## Options

Almost everything is set in teacher controls. Settings are saved to
`data/settings.json`, and the Canvas connection to `data/connection.json`. The optional
`config.json` only provides starting values:

| Key | Default | What it does |
| --- | --- | --- |
| `canvasUrl`, `token`, `courseId` | — | Canvas connection (normally set from the Canvas tab instead) |
| `adminPin` | none | PIN for teacher controls (or `ADMIN_PIN`) |
| `refreshSeconds` | `60` | How often to re-read Canvas |
| `port`, `host` | `3000`, `127.0.0.1` | Where the server listens (`--lan` listens on your network) |
| `dataDir` | `data` | Where teacher settings are saved |
| `title`, `nameFormat`, `characters`, `themes`, `moduleIds` | — | Starting values for teacher controls |

`config.json`, `data/` and `dist/` are git-ignored, so your token and class settings won't
be committed by accident.

## Privacy notes

This is meant to be shown to the class, so it shares as little as possible:

- **Names:** default to first name + last initial. You can switch to first names only or
  initials, or give anyone a nickname.
- **What displays receive:** display names, characters, progress, and positive badges
  only. Late and missing work, pace gaps, and real names appear only in teacher controls.
- **Teacher controls:** require a PIN from any device other than the one running Class
  Quest.
- **Rankings:** if public rankings stress some students, switch to cooperative mode, hide
  the leaderboard, or lean on class goals.

## Development

```sh
node --test test/*.test.js      # or: npm test
node scripts/package.js         # build the ready-to-run zips into dist/
```

The **Build downloads** GitHub Action does the packaging automatically. To publish a
release with the zips attached, change the number in `VERSION` and push. Pushing a
`v*` tag works too.

```
server.js          HTTP server: /api/state, /api/admin/*, static files
lib/canvas.js      Canvas REST client (pagination, retries, token origin check)
lib/progress.js    modules → levels, positions, pace, badges, ranks, events
lib/settings.js    teacher settings, validation, and screen membership
lib/tracker.js     refresh loop, event log, per-screen state
lib/runtime.js     connect / switch / disconnect Canvas without restarting
lib/admin.js       PIN sessions and CSV export
lib/instructions.js  exports assignment instructions and rubrics from Canvas
lib/sources.js     live Canvas source and the demo class
public/sprites.js  pixel-art characters and badge icons (shared with the server)
public/worlds.js   level themes, scenery, and obstacles
public/app.js      the class display
public/admin.js    teacher controls
launchers/         double-click start files for each OS
scripts/package.js builds the zips (verifies Node.js downloads by checksum)
scripts/export-instructions.js  saves all assignment instructions to instructions/
```
