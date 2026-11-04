// Minimal store: one state object, one dispatch. Framework-free so the MCP bridge can reuse it.
import { ACTION_TYPE_LIST } from './actions.js';

export const createStore = (reducer, initialState) => {
  let state = initialState;
  const listeners = new Set();

  const getState = () => state;

  const dispatch = (action) => {
    if (!action || typeof action !== 'object' || !ACTION_TYPE_LIST.includes(action.type)) {
      throw new TypeError(`Unknown action: ${JSON.stringify(action?.type ?? action)}`);
    }
    const prev = state;
    state = reducer(state, action);
    if (state !== prev) for (const fn of listeners) fn(state, prev, action);
    return state;
  };

  const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const serialise = () => JSON.stringify(state);

  const hydrate = (json) => dispatch({ type: 'HYDRATE', state: typeof json === 'string' ? JSON.parse(json) : json });

  return { getState, dispatch, subscribe, serialise, hydrate };
};
