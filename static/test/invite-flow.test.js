import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, waitFor, isVisible} from './harness.js';

// Invite-link auto-login storage key (mirrors galene.js).
const INVITE_KEY = 'galene.invite';
const LOGIN_KEY = 'galene.login';

function storedInvite(window) {
    const raw = window.localStorage.getItem(INVITE_KEY);
    if(!raw)
        return null;
    return JSON.parse(raw);
}

/**
 * Drives one client WebSocket conversation through the protocol up to the
 * point where the client sends its 'join' message, then returns the join
 * message.  The caller decides how to answer (need-username fail or a
 * successful join) via `answer`.
 *
 * @param {Window} window
 * @param {object} socket the scripted fake WebSocket instance
 * @param {(join: object) => object} answer returns the server reply object
 */
async function driveConnection(window, socket, answer) {
    socket.serverOpen();
    await waitFor(
        () => socket.received.some((m) => m.type === 'handshake'),
        'client never sent its handshake');
    socket.serverSend({type: 'handshake', version: ['2']});
    await waitFor(
        () => socket.received.some((m) => m.type === 'join'),
        'client never sent its join message');
    const join = socket.received.find((m) => m.type === 'join');
    socket.serverSend(answer(join));
    return join;
}

const needUsernameReply = (join) => ({
    type: 'joined',
    kind: 'fail',
    group: join.group,
    error: 'need-username',
    value: 'Username required',
});

const joinReply = (join, username) => ({
    type: 'joined',
    kind: 'join',
    group: join.group,
    username,
    permissions: ['message'],
    status: {},
    data: {},
});

function sockets(window) {
    return window.__sockets || [];
}

function submitLogin(document, window, username) {
    document.getElementById('username').value = username;
    const form = document.getElementById('loginform');
    form.dispatchEvent(new window.Event('submit', {cancelable: true}));
}

test('invite join, logout and rejoin under a new username', async () => {
    const TOKEN = 'tok-flow-1';
    const app = await loadApp({
        url: 'https://galene.test/galene.html?token=' + TOKEN,
        webSocket: true,
        waitLogin: false,
    });
    try {
        const w = app.window;
        const doc = app.document;

        // --- Connection 1: probing join.  The server reports that the
        // token needs a username, so the client shows a username-only
        // login form (the password form must stay hidden). ---
        await waitFor(
            () => sockets(w).length >= 1,
            'no probe connection was made: ' + JSON.stringify(app.errors));
        const probe = sockets(w)[0];
        await driveConnection(w, probe, needUsernameReply);

        await waitFor(
            () => isVisible(doc, 'login-container'),
            'login screen was not shown after need-username: ' +
                JSON.stringify(app.errors));
        assert.equal(isVisible(doc, 'passwordform'), false,
            'the password form must be hidden for invite users');
        assert.equal(isVisible(doc, 'userform'), true);

        // --- Connection 2: the invited user types "alice" and joins. ---
        submitLogin(doc, w, 'alice');
        await waitFor(
            () => sockets(w).length >= 2,
            'no real join connection was made: ' + JSON.stringify(app.errors));
        const real = sockets(w)[1];
        const joinMsg = await driveConnection(
            w, real, (join) => joinReply(join, 'alice'));

        // The token is still what we put in the URL and the username is
        // the one the user typed.
        assert.equal(joinMsg.token, TOKEN);
        assert.equal(joinMsg.username, 'alice');
        assert.equal(joinMsg.password, undefined);

        // A confirmed join persists the invite in storage.
        await waitFor(
            () => {
                const inv = storedInvite(w);
                return !!(inv && inv.username === 'alice');
            },
            'the invite was not stored after joining: ' +
                JSON.stringify(app.errors));

        // --- Logout: the password auto-login is dropped but the invite
        // token is kept, so the user can log back in under a username. ---
        doc.getElementById('logoutbutton').click();
        await waitFor(
            () => isVisible(doc, 'login-container'),
            'login screen was not shown after logout: ' +
                JSON.stringify(app.errors));
        assert.notEqual(storedInvite(w), null,
            'logout must keep the invite token for username-only rejoin');
        assert.equal(w.localStorage.getItem(LOGIN_KEY), null,
            'logout must still drop the password auto-login');
        assert.equal(isVisible(doc, 'passwordform'), false,
            'rejoining after logout must stay username-only');
        assert.equal(doc.getElementById('username').value, 'alice',
            'the remembered username should be pre-filled');

        // --- Connection 3: the user renames herself and rejoins. ---
        submitLogin(doc, w, 'bob');
        await waitFor(
            () => sockets(w).length >= 3,
            'no rejoin connection was made: ' + JSON.stringify(app.errors));
        const rejoin = sockets(w)[2];
        const rejoinMsg = await driveConnection(
            w, rejoin, (join) => joinReply(join, 'bob'));

        assert.equal(rejoinMsg.token, TOKEN,
            'the rejoining user must still authenticate with the token');
        assert.equal(rejoinMsg.username, 'bob');

        await waitFor(
            () => {
                const inv = storedInvite(w);
                return !!(inv && inv.username === 'bob');
            },
            'the stored invite was not updated to the new username: ' +
                JSON.stringify(app.errors));
        assert.equal(storedInvite(w).token, TOKEN);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('a rejected (revoked) token cannot be reused on logout', async () => {
    const TOKEN = 'tok-revoked';
    const app = await loadApp({
        url: 'https://galene.test/galene.html?token=' + TOKEN,
        webSocket: true,
        waitLogin: false,
    });
    try {
        const w = app.window;
        const doc = app.document;

        await waitFor(
            () => sockets(w).length >= 1,
            'no probe connection was made');
        await driveConnection(w, sockets(w)[0], needUsernameReply);
        await waitFor(
            () => isVisible(doc, 'login-container'),
            'login screen was not shown after need-username');

        // The user joins, then the token is revoked server-side.  On the
        // next attempt the server rejects the join outright.
        submitLogin(doc, w, 'alice');
        await waitFor(
            () => sockets(w).length >= 2,
            'no real join connection was made');
        await driveConnection(
            w, sockets(w)[1], (join) => joinReply(join, 'alice'));

        // Revoke: the client now logs out; gotClose would restore the
        // stored token, but the next real join fails.  The stored invite
        // must then be cleared so the user does not loop forever.
        const revocation = () => ({
            type: 'joined',
            kind: 'fail',
            group: 'group1',
            error: 'Not authorised',
            value: 'Token is not valid',
        });

        doc.getElementById('logoutbutton').click();
        await waitFor(
            () => isVisible(doc, 'login-container'),
            'login screen was not shown after logout');
        assert.notEqual(storedInvite(w), null);

        submitLogin(doc, w, 'bob');
        await waitFor(
            () => sockets(w).length >= 3,
            'no rejoin connection was made');
        await driveConnection(w, sockets(w)[2], revocation);

        // The rejected join clears the stored invite and leaves the user
        // on the (full) login screen.
        await waitFor(
            () => storedInvite(w) === null,
            'a rejected token should clear the stored invite: ' +
                JSON.stringify(app.errors));
        await waitFor(
            () => isVisible(doc, 'login-container'),
            'login screen was not shown after the rejected rejoin: ' +
                JSON.stringify(app.errors));
        assert.equal(storedInvite(w), null);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});
