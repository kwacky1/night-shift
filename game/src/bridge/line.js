// Why the intern line didn't connect, and what the player can do about it.
//
// On itch.io the game runs in a cross-origin iframe. Chrome and Edge (Local Network Access) block a
// public page from reaching ws://localhost unless the permission is granted, and in an iframe the
// parent has to delegate it. itch doesn't, so the dial fails silently with no prompt. Opened in its
// own tab, the same page gets the browser's "access other apps and services" prompt instead.
// Browsers keep an iframe's storage apart from the same site opened as a tab, so that tab has its
// own save.

// True inside any frame. A cross-origin parent can make the check throw; that's a frame too.
export const isFramed = (win = globalThis) => {
  try {
    return win.top !== win.self;
  } catch {
    return true;
  }
};

const PERMISSION_NAMES = ['local-network-access', 'loopback-network'];
const PERMISSION_STATES = new Set(['granted', 'prompt', 'denied']);

// The browser's Local Network Access permission for this page, if it will say:
// 'granted' | 'prompt' | 'denied', or null when the browser doesn't know the permission.
export const localNetworkPermission = async (nav = globalThis.navigator) => {
  const query = nav?.permissions?.query;
  if (typeof query !== 'function') return null;
  for (const name of PERMISSION_NAMES) {
    try {
      const { state } = await query.call(nav.permissions, { name });
      if (PERMISSION_STATES.has(state)) return state;
    } catch {
      // Unknown permission name in this browser: try the next one.
    }
  }
  return null;
};

export const ALLOW_PROMPT = "access other apps and services on this device";

// The banner INTERN.EXE shows when a dial gives up. openTab: offer OPEN IN ITS OWN TAB.
export const dialFailure = ({ framed = false, permission = null, attempts = 1 } = {}) => {
  if (framed) {
    return {
      title: 'LINE BLOCKED BY YOUR BROWSER',
      text: "The intern line can't get out of itch's frame. Open the game in its own tab and dial from there.",
      hint: `Allow '${ALLOW_PROMPT}' when asked. The new tab keeps its own save, so dial before you play far.`,
      openTab: true,
    };
  }
  const tries = attempts === 1 ? '1 try' : `${attempts} tries`;
  return {
    title: 'DIAL FAILED',
    text: `No answer after ${tries}. Is night-shift-mcp running (npx night-shift-mcp, or your agent's MCP config)?`,
    hint:
      permission === 'denied'
        ? `Your browser is blocking this page from the local network. Allow '${ALLOW_PROMPT}' in the site settings (padlock), then Retry.`
        : `If your browser asks to ${ALLOW_PROMPT}, click Allow. The scripted intern covers until then.`,
    openTab: false,
  };
};

// The address for OPEN IN ITS OWN TAB: this page, dialling the address the player just tried.
export const ownTabUrl = (href, dialUrl) => {
  const u = new URL(href);
  if (dialUrl) u.searchParams.set('intern', dialUrl);
  return u.toString();
};
