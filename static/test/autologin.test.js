import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, waitFor, isVisible} from './harness.js';

// The automatic-login feature stores {username, password, time} in
// localStorage under this key, with a 24h window of inactivity.
const LOGIN_KEY = 'galene.login';
const TTL = 24 * 60 * 60 * 1000;

function storedLogin(window) {
    const raw = window.localStorage.getItem(LOGIN_KEY);
    if(!raw)
        return null;
    return JSON.parse(raw);
}

test('a fresh stored login auto-logs in without showing the login screen', async () => {
    const app = await loadApp({
        localStorage: {
            [LOGIN_KEY]: JSON.stringify({
                username: 'alice',
                password: 'wonder',
                time: Date.now(),
            }),
        },
        webSocket: true,
        waitLogin: false,
    });
    try {
        // start() should have prefilled the credentials and attempted a
        // WebSocket connection to the room, not shown the Connect screen.
        await waitFor(
            () => app.window.__wsCalls.length >= 1,
            'no connection attempt was made: ' +
                JSON.stringify(app.errors));
        assert.equal(
            app.document.getElementById('username').value, 'alice');
        assert.equal(
            app.document.getElementById('password').value, 'wonder');
        assert.equal(isVisible(app.document, 'login-container'), false);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('an expired stored login falls back to the normal login screen', async () => {
    const app = await loadApp({
        localStorage: {
            [LOGIN_KEY]: JSON.stringify({
                username: 'alice',
                password: 'wonder',
                time: Date.now() - TTL - 1,
            }),
            // galene.username remembered separately
            'galene.username': 'bob',
        },
    });
    try {
        assert.equal(isVisible(app.document, 'login-container'), true);
        // The expired entry was removed.
        assert.equal(app.window.localStorage.getItem(LOGIN_KEY), null);
        // The username comes from galene.username, not the expired entry.
        assert.equal(
            app.document.getElementById('username').value, 'bob');
        assert.equal(app.document.getElementById('password').value, '');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('a failed automatic login falls back to the login screen', async () => {
    // No fake WebSocket: serverConnect() throws and start() must reveal
    // the regular login form so the user is not left on a blank page.
    const app = await loadApp({
        localStorage: {
            [LOGIN_KEY]: JSON.stringify({
                username: 'alice',
                password: 'wonder',
                time: Date.now(),
            }),
        },
        waitLogin: false,
    });
    try {
        await waitFor(
            () => isVisible(app.document, 'login-container'),
            'login screen was not shown after a failed auto-login: ' +
                JSON.stringify(app.errors));
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('logging out clears the stored credentials', async () => {
    const app = await loadApp({
        localStorage: {
            [LOGIN_KEY]: JSON.stringify({
                username: 'alice',
                password: 'wonder',
                time: Date.now(),
            }),
        },
        webSocket: true,
        waitLogin: false,
    });
    try {
        await waitFor(
            () => app.window.__wsCalls.length >= 1,
            'no connection attempt was made: ' +
                JSON.stringify(app.errors));
        assert.notEqual(storedLogin(app.window), null);
        app.document.getElementById('logoutbutton').click();
        assert.equal(storedLogin(app.window), null);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('stored login helpers respect the 24h expiry window', async () => {
    const app = await loadApp({});
    try {
        const w = app.window;
        w.setStoredLogin('carol', 'secret');
        const fresh = storedLogin(w);
        assert.equal(fresh.username, 'carol');
        assert.equal(fresh.password, 'secret');
        assert.ok(fresh.time > Date.now() - 1000);

        // Directly age the entry beyond the window.
        w.localStorage.setItem(LOGIN_KEY, JSON.stringify({
            username: 'carol',
            password: 'secret',
            time: Date.now() - TTL - 5000,
        }));
        assert.equal(w.getStoredLogin(), null);
        assert.equal(storedLogin(w), null);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});
