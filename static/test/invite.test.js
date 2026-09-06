import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, waitFor, isVisible} from './harness.js';

// Invite-link auto-login stores {group, token, username, time} in
// localStorage under this key, with the same 24h window as the
// password-based automatic login.
const INVITE_KEY = 'galene.invite';
const TTL = 24 * 60 * 60 * 1000;

function storedInvite(window) {
    const raw = window.localStorage.getItem(INVITE_KEY);
    if(!raw)
        return null;
    return JSON.parse(raw);
}

function inviteEntry(overrides = {}) {
    return JSON.stringify(Object.assign({
        group: 'group1',
        token: 'tok-abc-123',
        username: 'alice',
        time: Date.now(),
    }, overrides));
}

test('a fresh stored invite auto-logs in with the remembered username', async () => {
    const app = await loadApp({
        localStorage: {
            [INVITE_KEY]: inviteEntry(),
        },
        webSocket: true,
        waitLogin: false,
    });
    try {
        await waitFor(
            () => app.window.__wsCalls.length >= 1,
            'no connection attempt was made: ' +
                JSON.stringify(app.errors));
        // The username is remembered; no password form is shown for
        // invite users and no password is stored.
        assert.equal(
            app.document.getElementById('username').value, 'alice');
        assert.equal(isVisible(app.document, 'passwordform'), false);
        assert.equal(isVisible(app.document, 'login-container'), false);
        assert.equal(storedInvite(app.window).username, 'alice');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('an expired stored invite falls back to the normal login screen', async () => {
    const app = await loadApp({
        localStorage: {
            [INVITE_KEY]: inviteEntry({time: Date.now() - TTL - 1}),
        },
    });
    try {
        assert.equal(isVisible(app.document, 'login-container'), true);
        assert.equal(app.window.localStorage.getItem(INVITE_KEY), null);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('a stored invite for another group does not auto-login', async () => {
    const app = await loadApp({
        localStorage: {
            [INVITE_KEY]: inviteEntry({group: 'other-group'}),
        },
        webSocket: true,
        waitLogin: false,
    });
    try {
        // No connection attempt for the current group should be made.
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal((app.window.__wsCalls || []).length, 0);
        assert.equal(isVisible(app.document, 'login-container'), true);
        // The foreign-group entry is preserved.
        assert.equal(storedInvite(app.window).group, 'other-group');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('a failed automatic invite login falls back to the login screen', async () => {
    const app = await loadApp({
        localStorage: {
            [INVITE_KEY]: inviteEntry(),
        },
        waitLogin: false,
    });
    try {
        // No fake WebSocket: serverConnect() throws and start() must
        // reveal the regular login form.
        await waitFor(
            () => isVisible(app.document, 'login-container'),
            'login screen was not shown after a failed invite auto-login: ' +
                JSON.stringify(app.errors));
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('logging out clears the stored invite', async () => {
    const app = await loadApp({
        localStorage: {
            [INVITE_KEY]: inviteEntry(),
        },
        webSocket: true,
        waitLogin: false,
    });
    try {
        await waitFor(
            () => app.window.__wsCalls.length >= 1,
            'no connection attempt was made: ' +
                JSON.stringify(app.errors));
        assert.notEqual(storedInvite(app.window), null);
        app.document.getElementById('logoutbutton').click();
        assert.equal(storedInvite(app.window), null);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('invite storage helpers respect the 24h expiry and group scoping', async () => {
    const app = await loadApp({});
    try {
        const w = app.window;
        w.setStoredInvite('group1', 'tok-1', 'bob');
        assert.equal(storedInvite(w).username, 'bob');
        assert.ok(storedInvite(w).time > Date.now() - 1000);

        // Different group: kept but not returned for the current group.
        w.setStoredInvite('group2', 'tok-2', 'carol');
        assert.equal(w.getStoredInvite('group1'), null);
        assert.equal(storedInvite(w).group, 'group2');

        // Age the entry beyond the window.
        w.localStorage.setItem(INVITE_KEY, JSON.stringify({
            group: 'group1',
            token: 'tok-1',
            username: 'bob',
            time: Date.now() - TTL - 5000,
        }));
        assert.equal(w.getStoredInvite('group1'), null);
        assert.equal(storedInvite(w), null);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});
