# Class Quest

An 8-bit race view of your class's progress through a Canvas course. Each student gets
their own pixel robot, computer, or brick figure with their name above it. Every
**module is a level** with its own world (Green Hills, Sunset Dunes, Frost Peaks, Neon
Circuit, Lava Forge, Coral Deep, Star Station, Byte Castle). Every **required item in a
module is an obstacle**. When a student submits or completes an item, their character
runs forward and jumps over the next obstacle. Finishing a module sets off a level-up
burst, and the leaderboard shows where everyone stands.

- **Race view:** one lane per student, sorted by place. Put it on the classroom projector.
- **Student view:** click a lane or leaderboard row to see that student's current level
  up close. It shows a checklist of what's done and what's next, plus their whole journey.
- **News ticker and pop-ups** for things like "Ava S. reached Level 3" and "Ben J. takes the lead!"

It runs on your own computer, needs no `npm install`, and only talks to your Canvas
instance. Your Canvas token stays on the server and is never sent to the browser.

## Quick start (demo)

Requires [Node.js](https://nodejs.org) 18.17 or newer.

```sh
npm run demo
```

Open http://localhost:3000. The demo class makes progress every few seconds so you can
watch the animations.

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

4. To show it on another device (a classroom TV, say), run `npm run lan` and open the
   address it prints.

`config.json` is git-ignored so your token won't be committed by accident.

### How progress is measured

Class Quest uses Canvas **module completion requirements** (Modules → ⋮ → Edit →
*Add requirement*: "must submit", "must view", "must score at least", and so on).

- **Levels:** published modules that have at least one requirement, in course order.
  Modules with no requirements (like a "Course Info" module) are skipped so they aren't
  free levels.
- **Obstacles:** the required items in each module.
- **Current level:** the first module the student hasn't completed. Their position inside
  that level is the share of its requirements they've met.
- **Place:** furthest along the track first. Ties share a place.

Canvas is checked every `refreshSeconds` (60 by default, minimum 15). Each refresh makes
about one request per student. Requests run four at a time, and the app backs off
automatically if Canvas rate-limits it.

## Options (`config.json`)

| Key | Default | What it does |
| --- | --- | --- |
| `canvasUrl`, `token`, `courseId` | — | Canvas connection (or `CANVAS_URL`, `CANVAS_TOKEN`, `CANVAS_COURSE_ID`) |
| `title` | course name | Heading shown on screen |
| `refreshSeconds` | `60` | How often to re-read Canvas |
| `nameFormat` | `first-last-initial` | `first-last-initial` (Ava S.), `first`, `initials` (A.S.), `display` (Canvas display name), `full` |
| `moduleIds` | all | Array of module IDs to use as levels, in the order you want |
| `themes` | auto | Pick a world per module, e.g. `{ "678": "lava" }`. Worlds: `hills`, `desert`, `ice`, `cyber`, `lava`, `ocean`, `space`, `castle` |
| `characters` | auto | Pick a character per student by Canvas user ID, e.g. `{ "4421": "robot-3" }`. Click **Characters** at the bottom of the page to see them all. |
| `port`, `host` | `3000`, `127.0.0.1` | Where the server listens |

There are 36 characters (3 types × 12 colors). They're assigned automatically and stay
the same between refreshes. Each student gets a different one until all 36 are used.

## Privacy notes

This is meant to be shown to the class, so think about what's visible:

- Names default to first name + last initial. Use `"nameFormat": "first"` or
  `"initials"` if you want less shown.
- Only names, characters, and progress are sent to the browser. Canvas user IDs, emails,
  and grades are not.
- Public rankings motivate some students and stress others. You can hide the leaderboard
  panel with the **Board** button. Showing just the track still shows progress.

## Development

```sh
npm test
```

```
server.js          HTTP server: /api/state + static files
lib/canvas.js      Canvas REST client (pagination, retries, token origin check)
lib/progress.js    modules → levels, positions, ranks, characters, events
lib/sources.js     live Canvas source and the demo class
lib/tracker.js     refresh loop and event log
public/sprites.js  pixel-art characters (shared with the server)
public/worlds.js   level themes, scenery, and obstacles
public/app.js      race view, animations, student view
```
