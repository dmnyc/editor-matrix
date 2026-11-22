'use strict';

// The case steps as a Mac keyboard does them, for a web driver: the key, the modifiers held,
// and the editing commands Chrome must be told the key stands for (DevTools key events carry
// no meaning on a Mac of their own; Firefox maps modifiers itself and ignores `commands`).

const MOVE = {
  left: ['ArrowLeft', {}, 'moveLeft'],
  right: ['ArrowRight', {}, 'moveRight'],
  up: ['ArrowUp', {}, 'moveUp'],
  down: ['ArrowDown', {}, 'moveDown'],
  wordLeft: ['ArrowLeft', { alt: true }, 'moveWordLeft'],
  wordRight: ['ArrowRight', { alt: true }, 'moveWordRight'],
  lineStart: ['ArrowLeft', { meta: true }, 'moveToBeginningOfLine'],
  lineEnd: ['ArrowRight', { meta: true }, 'moveToEndOfLine'],
  docStart: ['ArrowUp', { meta: true }, 'moveToBeginningOfDocument'],
  docEnd: ['ArrowDown', { meta: true }, 'moveToEndOfDocument'],
};

const chord = (key, mods = {}, command) => ({ key, ...mods, commands: command ? [command] : undefined });

function keysFor(step) {
  const [kind, arg] = step;
  switch (kind) {
    case 'key':
      if (arg === 'Enter') return chord('Enter');
      if (arg === 'ShiftEnter') return chord('Enter', { shift: true }, 'insertLineBreak');
      if (arg === 'Backspace') return chord('Backspace', {}, 'deleteBackward');
      if (arg === 'Delete') return chord('Delete', {}, 'deleteForward');
      break;
    case 'move': { const [k, m, c] = MOVE[arg]; return chord(k, m, c); }
    case 'select': {
      const [k, m, c] = MOVE[arg];
      return chord(k, { ...m, shift: true }, c + 'AndModifySelection');
    }
    case 'selectAll': return chord('a', { meta: true }, 'selectAll');
    case 'delete':
      if (arg === 'wordBack') return chord('Backspace', { alt: true }, 'deleteWordBackward');
      if (arg === 'wordForward') return chord('Delete', { alt: true }, 'deleteWordForward');
      if (arg === 'lineBack') return chord('Backspace', { meta: true }, 'deleteToBeginningOfLine');
      break;
    case 'undo': return chord('z', { meta: true }, 'undo');
    case 'redo': return chord('z', { meta: true, shift: true }, 'redo');
    case 'copy': return chord('c', { meta: true }, 'copy');
    case 'cut': return chord('x', { meta: true }, 'cut');
    case 'paste': return chord('v', { meta: true }, 'paste');
  }
  throw new Error('no keys for step ' + JSON.stringify(step));
}

module.exports = { keysFor };
