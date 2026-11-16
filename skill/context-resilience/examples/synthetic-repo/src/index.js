"use strict";

const PUBLIC_MODE = "safe";

function createNote(input) {
  return {
    id: "note-example",
    text: String(input || "").trim(),
    mode: PUBLIC_MODE,
  };
}

module.exports = { createNote, PUBLIC_MODE };
