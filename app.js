(() => {
  "use strict";

  const TILE_MOVE_DURATION_MS = 300; // Keep --tile-move-duration in styles.css in sync.
  const HISTORY_LIMIT = 100;
  const SHUFFLE_MOVES = 240;
  const THEME_KEY = "fifteen-puzzle-theme";
  const GAME_KEY = "fifteen-puzzle-game";
  const RESULT_KEY = "playground.result.15puzzle.v1";
  const byId = (id) => document.getElementById(id);
  const elements = {
    board: byId("board"), moves: byId("moves"), time: byId("time"),
    badge: byId("game-state"), cover: byId("pause-cover"), status: byId("status"),
    newGame: byId("new-game"), reset: byId("reset"), undo: byId("undo"),
    pause: byId("pause"), themeToggle: byId("theme-toggle"), resetDialog: byId("reset-dialog"),
    successDialog: byId("success-dialog"), successText: byId("success-description"),
    newGameDialog: byId("new-game-dialog")
  };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  const state = {
    board: [], initialBoard: [], history: [], moves: 0, hasMoved: false,
    paused: false, solved: false, animating: false, elapsedMs: 0,
    timerStartedAt: null, timerId: null, animation: null, theme: "system"
  };
  const tiles = new Map();
  const blank = document.createElement("div");
  blank.setAttribute("aria-hidden", "true");

  function createSolvedBoard() {
    return Array.from({ length: 16 }, (_, index) => (index + 1) % 16);
  }

  function isSolved(board) {
    return board.every((value, index) => value === (index + 1) % 16);
  }

  function isSolvable(board) {
    const values = board.filter((value) => value !== 0);
    const blankRowFromBottom = 4 - Math.floor(board.indexOf(0) / 4);
    let inversions = 0;
    for (let i = 0; i < values.length; i += 1) {
      for (let j = i + 1; j < values.length; j += 1) {
        if (values[i] > values[j]) inversions += 1;
      }
    }
    return (inversions + blankRowFromBottom) % 2 === 1;
  }

  function getMovableTileIndexes(board) {
    const empty = board.indexOf(0);
    return board.reduce((indexes, value, index) => {
      const distance = Math.abs(Math.floor(index / 4) - Math.floor(empty / 4))
        + Math.abs(index % 4 - empty % 4);
      if (value !== 0 && distance === 1) indexes.push(index);
      return indexes;
    }, []);
  }

  function createShuffledBoard() {
    for (;;) {
      const board = createSolvedBoard();
      let previousEmpty = -1;
      for (let step = 0; step < SHUFFLE_MOVES; step += 1) {
        const empty = board.indexOf(0);
        const choices = getMovableTileIndexes(board).filter((index) => index !== previousEmpty);
        const next = choices[Math.floor(Math.random() * choices.length)];
        [board[empty], board[next]] = [board[next], board[empty]];
        previousEmpty = empty;
      }
      if (!isSolved(board) && isSolvable(board)) return board;
    }
  }

  function updateStatusMessage(message) {
    elements.status.replaceChildren(document.createTextNode(message));
  }

  function saveGame() {
    try {
      localStorage.setItem(GAME_KEY, JSON.stringify({
        version: 1, board: state.board, initialBoard: state.initialBoard,
        history: state.history, moves: state.moves, hasMoved: state.hasMoved,
        paused: state.paused, elapsedMs: elapsedTime()
      }));
    } catch { /* Play remains available when browser storage is blocked or full. */ }
  }

  function saveCompletedResult() {
    try {
      const previous = JSON.parse(localStorage.getItem(RESULT_KEY));
      const stats = previous?.version === 1 && previous.app === "15puzzle" && previous.stats && typeof previous.stats === "object"
        ? previous.stats : {};
      const elapsed = Math.max(0, Math.round(elapsedTime()));
      const completedCount = (Number.isSafeInteger(stats.completedCount) ? stats.completedCount : 0) + 1;
      const fastestTimeMs = Math.min(Number.isFinite(stats.fastestTimeMs) ? stats.fastestTimeMs : Infinity, elapsed);
      const bestMoves = Math.min(Number.isSafeInteger(stats.bestMoves) ? stats.bestMoves : Infinity, state.moves);
      localStorage.setItem(RESULT_KEY, JSON.stringify({
        version: 1, app: "15puzzle", updatedAt: Date.now(),
        summary: { primary: `Best: ${formatElapsedTime(fastestTimeMs)}`, secondary: `${bestMoves} moves · ${completedCount} completed` },
        stats: { completedCount, fastestTimeMs, bestMoves, last: { elapsedMs: elapsed, moves: state.moves, completedAt: Date.now() } }
      }));
    } catch { /* Results are optional when storage is blocked or malformed. */ }
  }

  function isValidSavedBoard(board) {
    return Array.isArray(board) && board.length === 16 && new Set(board).size === 16
      && board.every((value) => Number.isInteger(value) && value >= 0 && value < 16)
      && isSolvable(board);
  }

  function isValidSavedGame(saved) {
    if (!saved || saved.version !== 1 || !isValidSavedBoard(saved.board)
      || !isValidSavedBoard(saved.initialBoard) || isSolved(saved.initialBoard)
      || !Number.isSafeInteger(saved.moves) || saved.moves < 0
      || typeof saved.hasMoved !== "boolean" || typeof saved.paused !== "boolean"
      || !Number.isFinite(saved.elapsedMs) || saved.elapsedMs < 0
      || !Array.isArray(saved.history) || saved.history.length > HISTORY_LIMIT
      || saved.history.length > saved.moves
      || !saved.history.every((board) => isValidSavedBoard(board) && !isSolved(board))) return false;
    if (!saved.hasMoved && (saved.moves !== 0 || saved.elapsedMs !== 0)) return false;
    if (saved.moves === 0 && !saved.board.every((value, index) => value === saved.initialBoard[index])) return false;
    if (isSolved(saved.board) && saved.paused) return false;
    // Each history entry must lead to the next board through exactly one legal move.
    return saved.history.every((board, index) => {
      const next = saved.history[index + 1] || saved.board;
      const empty = board.indexOf(0);
      const tileIndex = next.indexOf(0);
      return getMovableTileIndexes(board).includes(tileIndex)
        && next[empty] === board[tileIndex]
        && board.every((value, cell) => cell === empty || cell === tileIndex || value === next[cell]);
    });
  }

  function restoreGame() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(GAME_KEY)); } catch { return false; }
    if (!isValidSavedGame(saved)) return false;
    state.board = saved.board;
    state.initialBoard = saved.initialBoard;
    state.history = saved.history;
    state.moves = saved.moves;
    state.hasMoved = saved.hasMoved;
    state.paused = saved.paused;
    state.solved = isSolved(saved.board);
    state.elapsedMs = saved.elapsedMs;
    // Time spent with the page closed is not added to playing time.
    startTimer();
    renderBoard();
    renderTime();
    updateStatusMessage(state.solved ? "Saved puzzle restored. Already solved!" : state.paused
      ? "Saved game restored. Still paused; choose Resume to play." : "Saved game restored. Use Arrow keys or tap a marked tile.");
    return true;
  }

  function renderBoard() {
    const movable = getMovableTileIndexes(state.board);
    const available = !state.paused && !state.solved && !state.animating;
    const empty = state.board.indexOf(0);
    state.board.forEach((value, index) => {
      if (value === 0) {
        blank.className = `blank position-${index}`;
        return;
      }
      const tile = tiles.get(value);
      const canMove = available && movable.includes(index);
      tile.className = `tile position-${index}${canMove ? " movable" : ""}`;
      tile.setAttribute("aria-disabled", String(!canMove));
      tile.setAttribute("aria-label", `Tile ${value}, ${canMove ? "movable" : "not movable"}, row ${Math.floor(index / 4) + 1}, column ${index % 4 + 1}`);
      tile.dataset.direction = empty === index - 4 ? "↑" : empty === index + 4 ? "↓" : empty < index ? "←" : "→";
    });
    elements.board.inert = state.paused;
    elements.cover.hidden = !state.paused;
    elements.moves.textContent = String(state.moves);
    elements.badge.textContent = state.solved ? "✓ Solved" : state.paused ? "Ⅱ Paused" : state.hasMoved ? "▶ Playing" : "○ Ready";
    elements.pause.textContent = state.paused ? "Resume" : "Pause";
    elements.pause.disabled = state.animating || state.solved;
    elements.undo.disabled = state.animating || state.history.length === 0;
    elements.newGame.disabled = state.animating;
    elements.reset.disabled = state.animating;
  }

  function elapsedTime() {
    return state.elapsedMs + (state.timerStartedAt === null ? 0 : performance.now() - state.timerStartedAt);
  }

  function formatElapsedTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function renderTime() {
    elements.time.textContent = formatElapsedTime(elapsedTime());
  }

  function startTimer() {
    if (state.timerStartedAt !== null || state.paused || state.solved || !state.hasMoved) return;
    state.timerStartedAt = performance.now();
    state.timerId = window.setInterval(() => {
      renderTime();
      saveGame();
    }, 1000);
  }

  function stopTimer() {
    state.elapsedMs = elapsedTime();
    state.timerStartedAt = null;
    window.clearInterval(state.timerId);
    state.timerId = null;
    renderTime();
  }

  function openDialog(dialog) {
    if (!dialog.open) dialog.showModal();
  }

  async function animateTileMove(tile, oldPosition) {
    const newPosition = tile.getBoundingClientRect();
    const duration = reducedMotion.matches ? 0 : TILE_MOVE_DURATION_MS;
    if (duration === 0) return;
    tile.classList.add("sliding");
    const animation = tile.animate([
      { transform: `translate(${oldPosition.left - newPosition.left}px, ${oldPosition.top - newPosition.top}px)` },
      { transform: "translate(0, 0)" }
    ], { duration, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    state.animation = animation;
    try {
      await animation.finished;
    } catch (error) {
      if (error.name !== "AbortError") throw error;
    } finally {
      state.animation = null;
      tile.classList.remove("sliding");
    }
  }

  function saveMoveToHistory() {
    state.history.push(state.board.slice());
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
  }

  async function moveTile(index) {
    if (state.paused || state.solved || state.animating || elements.resetDialog.open || elements.successDialog.open || elements.newGameDialog.open) return;
    if (!getMovableTileIndexes(state.board).includes(index)) return;
    elements.board.classList.remove("new-game-effect");
    const tile = tiles.get(state.board[index]);
    const oldPosition = tile.getBoundingClientRect();
    const empty = state.board.indexOf(0);
    state.animating = true;
    saveMoveToHistory();
    state.hasMoved = true;
    startTimer();
    [state.board[index], state.board[empty]] = [state.board[empty], state.board[index]];
    state.moves += 1;
    state.solved = isSolved(state.board);
    if (state.solved) stopTimer();
    renderBoard();
    saveGame();
    await animateTileMove(tile, oldPosition);
    state.animating = false;
    renderBoard();
    if (state.solved) {
      saveCompletedResult();
      const message = `Puzzle solved in ${state.moves} moves and ${formatElapsedTime(elapsedTime())}.`;
      elements.successText.textContent = message;
      updateStatusMessage(message);
      openDialog(elements.successDialog);
    }
  }

  function moveTileInDirection(direction) {
    const empty = state.board.indexOf(0);
    // Select the tile opposite the requested direction so it slides that way.
    const offsets = { ArrowUp: 4, ArrowDown: -4, ArrowLeft: 1, ArrowRight: -1 };
    void moveTile(empty + offsets[direction]);
  }

  function loadGame(board) {
    stopTimer();
    state.board = board.slice();
    state.history = [];
    state.moves = 0;
    state.hasMoved = false;
    state.paused = false;
    state.solved = false;
    state.elapsedMs = 0;
    renderBoard();
    renderTime();
    saveGame();
  }

  function requestNewGame() {
    if (state.animating) return;
    if (state.hasMoved) openDialog(elements.newGameDialog);
    else startNewGame();
  }

  function startNewGame() {
    if (state.animating) return;
    if (elements.successDialog.open) elements.successDialog.close();
    state.initialBoard = createShuffledBoard();
    loadGame(state.initialBoard);
    elements.board.classList.remove("new-game-effect");
    void elements.board.offsetWidth; // Restart the short arrival effect, even on consecutive games.
    elements.board.classList.add("new-game-effect");
    updateStatusMessage("New game started. Your first move starts the timer.");
  }

  function resetCurrentGame() {
    loadGame(state.initialBoard);
    updateStatusMessage("Puzzle reset to its original shuffle. Timer ready.");
  }

  async function undoLastMove() {
    if (state.animating || state.history.length === 0) return;
    if (elements.successDialog.open) elements.successDialog.close();
    const previous = state.history.pop();
    const tile = tiles.get(previous[state.board.indexOf(0)]);
    const oldPosition = tile.getBoundingClientRect();
    state.animating = true;
    state.board = previous;
    state.moves -= 1;
    state.solved = false;
    startTimer();
    renderBoard();
    saveGame();
    await animateTileMove(tile, oldPosition);
    state.animating = false;
    renderBoard();
    updateStatusMessage(`Move undone. ${state.moves} moves.${state.paused ? " Still paused." : ""}`);
  }

  function togglePause() {
    if (state.animating || state.solved) return;
    state.paused = !state.paused;
    if (state.paused) stopTimer();
    else startTimer();
    renderBoard();
    saveGame();
    updateStatusMessage(state.paused ? "Timer paused. Board locked." : "Timer resumed. Board ready; timing begins after your first move.");
  }

  function applyTheme(theme) {
    state.theme = ["light", "dark", "system"].includes(theme) ? theme : "system";
    document.documentElement.dataset.theme = state.theme;
    const resolvedTheme = state.theme === "system" ? (colorScheme.matches ? "dark" : "light") : state.theme;
    const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
    elements.themeToggle.setAttribute("aria-checked", String(resolvedTheme === "dark"));
    elements.themeToggle.title = `Switch to ${nextTheme} theme`;
  }

  for (let value = 1; value <= 15; value += 1) {
    const tile = document.createElement("button");
    tile.type = "button";
    const number = document.createElement("span");
    number.textContent = String(value);
    number.setAttribute("aria-hidden", "true");
    tile.append(number);
    tile.addEventListener("click", () => { void moveTile(state.board.indexOf(value)); });
    tiles.set(value, tile);
    elements.board.append(tile);
  }
  elements.board.append(blank);
  document.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.defaultPrevented || event.isComposing || event.target.isContentEditable
      || event.target.closest("input, select, textarea, [role='textbox']")
      || elements.resetDialog.open || elements.successDialog.open || elements.newGameDialog.open || state.paused || state.solved) return;
    event.preventDefault();
    if (!event.repeat) moveTileInDirection(event.key);
  });
  elements.newGame.addEventListener("click", requestNewGame);
  elements.undo.addEventListener("click", () => { void undoLastMove(); });
  elements.pause.addEventListener("click", togglePause);
  elements.reset.addEventListener("click", () => {
    if (state.hasMoved) openDialog(elements.resetDialog);
    else resetCurrentGame();
  });
  byId("reset-form").addEventListener("submit", (event) => {
    if (event.submitter?.value !== "reset") return;
    event.preventDefault();
    elements.resetDialog.close();
    resetCurrentGame();
  });
  byId("new-game-form").addEventListener("submit", (event) => {
    if (event.submitter?.value !== "new") return;
    event.preventDefault();
    elements.newGameDialog.close();
    startNewGame();
  });
  byId("success-form").addEventListener("submit", (event) => {
    const action = event.submitter?.value;
    if (action !== "new" && action !== "undo") return;
    event.preventDefault();
    elements.successDialog.close();
    if (action === "new") requestNewGame();
    else void undoLastMove();
  });
  elements.themeToggle.addEventListener("click", () => {
    const nextTheme = elements.themeToggle.getAttribute("aria-checked") === "true" ? "light" : "dark";
    applyTheme(nextTheme);
    try { localStorage.setItem(THEME_KEY, state.theme); } catch { /* Storage can be blocked for local files. */ }
  });
  colorScheme.addEventListener("change", () => {
    if (state.theme === "system") applyTheme("system");
  });
  // Finish a slide if geometry or motion preferences change during it.
  window.addEventListener("resize", () => state.animation?.finish());
  window.addEventListener("pagehide", saveGame);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveGame();
  });
  reducedMotion.addEventListener("change", () => state.animation?.finish());
  elements.board.addEventListener("animationend", () => elements.board.classList.remove("new-game-effect"));
  let savedTheme = "system";
  try { savedTheme = localStorage.getItem(THEME_KEY) || "system"; } catch { /* System remains the fallback. */ }
  applyTheme(savedTheme);
  if (!restoreGame()) startNewGame();
})();
