# Monteur pilot completion

Base: pilot/monteur-chatbot-test-20261023. Local feature branch: feat/monteur-pilot-completion-20261028.

The existing pilot now handles first PIN change with a mandatory fresh login; delayed JSON, binary and Firebase responses cannot restore a logged-out identity. The main office app and office-pilot.html share the escaped report rubric and independent site/author filters. Revoked office sessions clear private state. The pilot config accepts a separate workers.dev endpoint or loopback HTTP from a loopback page; it refuses the production worker. Main office Firebase initialization is restricted to local demo-lagertool emulators.

Run with Node 22+: `node --test test/*.test.mjs` (39 passed on Node 24 in this task). The backend's `npm run test:pilot:local` runs nine real Chromium sections against this frontend and injected in-memory storage. See backend docs for exact setup. No Firebase emulator is replaced by those tests.

No deploy, remote push, main change or PR modification performed. The main office Firebase SDK flow still requires the blocked emulator suites for final acceptance. This branch is an isolated pilot, not a production deployment.
