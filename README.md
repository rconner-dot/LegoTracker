# Class Quest

An 8-bit race view of your class's progress through a Canvas course. Each student gets
their own pixel robot, computer, or brick figure with their name above it. Every
**module is a level** with its own world (Green Hills, Sunset Dunes, Frost Peaks, Neon
Circuit, Lava Forge, Coral Deep, Star Station, Byte Castle). Every **required item in a
module is an obstacle**. When a student turns something in, their character runs forward
and jumps over the next obstacle.

**On the class display**

- **Race track:** one lane per student, with a crown on the leader and a leaderboard
  panel.
- **Screens:** a separate display for each class period, small group, or any set of
  students you choose. Each one is ranked among its own students.
- **Student close-up:** click a lane (or turn on **Spotlight** to cycle automatically) to
  see that student's level, their checklist with due dates, their badges, and their
  whole journey.
- **Class goals:** a shared progress bar ("200 challenges → Pizza party") that everyone
  on the screen pushes forward, with a celebration when it's reached.
- **Pace marker:** a dashed line and a little ghost showing where the class should be,
  based on Canvas due dates.
- **Badges:** 🏆 Champion, ⭐ Trailblazer (first to clear a level), 🔥 On Fire (work
  turned in on 3 days this week, and the character gets a flame), 🕒 Early Bird, and
  🛡 Clockwork. Badges only celebrate. Nothing on the display shows late or missing work.
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
- **Display:** set the title, name style, race or cooperative mode, leaderboard, pace
  marker, sound, and spotlight timing.
- **Insights (private):** who's behind pace, last time each student turned something in,
  missing and late counts, and a CSV export.

It runs on your own computer, needs no `npm install`, and only talks to your Canvas
instance. Your Canvas token stays on the server. Displays never receive Canvas IDs, real
names, or grades.

## Quick start (demo)

Requires [Node.js](https://nodejs.org) 18.17 or newer.

```sh
npm run demo
```

Open http://localhost:3000 for the display and http://localhost:3000/admin for teacher
controls. The demo class has three sections and makes progress every few seconds.

## Connecting to Canvas

1. **Get an access token.** In Canvas go to **Account → Settings → Approved
   Integrations → + New Access Token**. Use an account that is a **teacher or TA** in the
   course, because reading each student's module progress needs that permission.
2. **Find the course ID.** It's the number in the course URL:
   `https://yourschool.instructure.com/courses/`**`12345`**.
3. **Configure.** Copy `config.example.json` to `config.json` and fill it in. You can
   also use environment variables, which take priority over the file:

   ```sh
   export CANVAS_URL=https://yourschool.instructure.com
   export CANVAS_TOKEN=...        # keep this secret
   export CANVAS_COURSE_ID=12345
   npm start
   ```

4. Open http://localhost:3000/admin to set up your screens.

### Showing it on another device

Run `npm run lan` and open the network address it prints on the classroom TV or
projector. Teacher controls then need a PIN:

- If you don't set one, a random PIN is printed when Class Quest starts.
- To choose your own, set `ADMIN_PIN` (or `"adminPin"` in `config.json`).

On the computer running Class Quest itself, teacher controls open without a PIN unless
you set one.

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
- **Badges:** based on the course's submissions:
  - **Trailblazer:** the first student to complete a module.
  - **On Fire:** submissions on 3 or more different days in the last week.
  - **Early Bird:** 3 or more submissions at least 24 hours before the due date.
  - **Clockwork:** 5 or more submissions with none late.

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
| `&sound=1` | Start with sound on (browsers may still need one click first) |

## Options

Almost everything is set in teacher controls and saved to `data/settings.json`.
`config.json` only provides the connection and starting values:

| Key | Default | What it does |
| --- | --- | --- |
| `canvasUrl`, `token`, `courseId` | — | Canvas connection (or `CANVAS_URL`, `CANVAS_TOKEN`, `CANVAS_COURSE_ID`) |
| `adminPin` | none | PIN for teacher controls (or `ADMIN_PIN`) |
| `refreshSeconds` | `60` | How often to re-read Canvas |
| `port`, `host` | `3000`, `127.0.0.1` | Where the server listens (`--lan` listens on your network) |
| `dataDir` | `data` | Where teacher settings are saved |
| `title`, `nameFormat`, `characters`, `themes`, `moduleIds` | — | Starting values for teacher controls |

`config.json` and `data/` are git-ignored, so your token and class settings won't be
committed by accident.

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
npm test
```

```
server.js          HTTP server: /api/state, /api/admin/*, static files
lib/canvas.js      Canvas REST client (pagination, retries, token origin check)
lib/progress.js    modules → levels, positions, pace, badges, ranks, events
lib/settings.js    teacher settings, validation, and screen membership
lib/tracker.js     refresh loop, event log, per-screen state
lib/admin.js       PIN sessions and CSV export
lib/sources.js     live Canvas source and the demo class
public/sprites.js  pixel-art characters and badge icons (shared with the server)
public/worlds.js   level themes, scenery, and obstacles
public/app.js      the class display
public/admin.js    teacher controls
```
