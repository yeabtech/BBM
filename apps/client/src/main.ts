import "./style.css";
import { setupGameOrientation } from "./game/screen-orientation.js";

const lobby = document.querySelector<HTMLElement>("#lobby-root");
const gameRoot = document.querySelector<HTMLElement>("#game-root");
if (!lobby || !gameRoot) throw new Error("Missing BBM application mount point");

// The solo scene is reachable as `/play` from the dev server and as the static
// `play.html` entry when the API server hosts the production build.
if (/\/play(\.html)?$/.test(window.location.pathname)) {
  lobby.hidden = true;
  gameRoot.hidden = false;
  setupGameOrientation(gameRoot);
  void import("./game/create-game.js").then(({ createGame }) => {
    const game = document.querySelector<HTMLElement>("#game");
    if (!game) throw new Error("Missing game canvas mount point");
    createGame(game);
  });
} else {
  gameRoot.hidden = true;
  void import("./lobby/mount-lobby.js").then(({ mountLobby }) =>
    mountLobby(lobby),
  );
}
