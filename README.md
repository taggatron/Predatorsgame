# Predators & Prey (Multiplayer)

A simple online multiplayer game simulating predators (foxes) and prey (rabbits). Players move around a forest, rabbits can meet to allow new rabbits to join, and foxes hunt rabbits with energy and reproduction rules.

## Features
- Lobby with name/species selection
- Admin modal (user: `dan`, password: `tagg`) to set max foxes and rabbits
- Mobile-friendly virtual joystick
- Player names displayed above sprites
- Hearts when rabbits meet, new rabbit slot opens
- Foxes eat rabbits: rabbit returns to lobby, fox gains energy and brief speed boost
- Foxes reproduce after eating 2 rabbits (adds one fox slot)
- Fox energy timer: 45 seconds, refilled by eating
- Forest background SVG with river through the middle

## Run locally (macOS, zsh)

```sh
npm install
npm run start
# open http://localhost:3000
```

Dev with auto-restart:

```sh
npm run dev
```

Notes:
- If the game is at capacity, you will wait in the lobby until a slot opens.
- Admin settings apply immediately and may admit queued players.