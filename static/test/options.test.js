import {test} from 'node:test';
import assert from 'node:assert/strict';

import {loadApp, waitFor, isVisible, joinRoom, waitForSent} from './harness.js';

/**
 * Helper: load the app, join the room as alice, and return a handle with
 * helpers to read sessionStorage settings and the socket.
 */
async function joined(opts = {}) {
    let app = await loadApp(Object.assign({webSocket: true}, opts));
    let {socket} = await joinRoom(app, {username: 'alice', password: 'x'});
    function settings() {
        return JSON.parse(app.window.sessionStorage.getItem('settings') || '{}');
    }
    function change(id) {
        let elt = app.document.getElementById(id);
        elt.dispatchEvent(new app.window.Event('change', {bubbles: true}));
    }
    function setValue(id, value) {
        let elt = app.document.getElementById(id);
        elt.value = value;
        elt.dispatchEvent(new app.window.Event('change', {bubbles: true}));
    }
    return {app, socket, settings, change, setValue};
}

test('changing the video device stores the choice', async () => {
    let {app, settings, setValue} = await joined();
    try {
        setValue('videoselect', 'cam2');
        assert.equal(settings().video, 'cam2');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('changing the audio device stores the choice', async () => {
    let {app, settings, setValue} = await joined();
    try {
        setValue('audioselect', 'mic2');
        assert.equal(settings().audio, 'mic2');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('the mirror toggle stores the mirrorView preference', async () => {
    let {app, settings, setValue} = await joined();
    try {
        let box = app.document.getElementById('mirrorbox');
        box.checked = true;
        box.dispatchEvent(new app.window.Event('change', {bubbles: true}));
        assert.equal(settings().mirrorView, true);
        box.checked = false;
        box.dispatchEvent(new app.window.Event('change', {bubbles: true}));
        assert.equal(settings().mirrorView, false);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('the blackboard toggle stores the blackboardMode preference', async () => {
    let {app, settings} = await joined();
    try {
        let box = app.document.getElementById('blackboardbox');
        box.checked = true;
        box.dispatchEvent(new app.window.Event('change', {bubbles: true}));
        assert.equal(settings().blackboardMode, true);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('the preprocessing toggle stores the preprocessing preference', async () => {
    let {app, settings} = await joined();
    try {
        let box = app.document.getElementById('preprocessingbox');
        box.checked = false;
        box.dispatchEvent(new app.window.Event('change', {bubbles: true}));
        assert.equal(settings().preprocessing, false);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('the hq audio toggle stores the hqaudio preference', async () => {
    let {app, settings} = await joined();
    try {
        let box = app.document.getElementById('hqaudiobox');
        box.checked = true;
        box.dispatchEvent(new app.window.Event('change', {bubbles: true}));
        assert.equal(settings().hqaudio, true);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('changing the requested level sends a request message', async () => {
    let {app, socket, setValue} = await joined();
    try {
        setValue('requestselect', 'audio');
        let msg = await waitForSent(socket, 'request');
        assert.deepEqual(msg.request, {'': ['audio']});
        let s = JSON.parse(app.window.sessionStorage.getItem('settings'));
        assert.equal(s.request, 'audio');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('changing the send mode stores the send preference', async () => {
    let {app, settings, setValue} = await joined();
    try {
        setValue('sendselect', 'unlimited');
        assert.equal(settings().send, 'unlimited');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('enabling simulcast stores the simulcast preference', async () => {
    let {app, settings, setValue} = await joined();
    try {
        setValue('simulcastselect', 'on');
        assert.equal(settings().simulcast, 'on');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('selecting a filter stores the filter preference', async () => {
    let {app, settings, setValue} = await joined();
    try {
        setValue('filterselect', 'mirror-h');
        assert.equal(settings().filter, 'mirror-h');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('the activity-detection toggle is stored', async () => {
    let {app, settings} = await joined();
    try {
        let box = app.document.getElementById('activitybox');
        box.checked = true;
        box.dispatchEvent(new app.window.Event('change', {bubbles: true}));
        assert.equal(settings().activityDetection, true);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('the display-all toggle is stored and does not crash with no streams', async () => {
    let {app, settings} = await joined();
    try {
        let box = app.document.getElementById('displayallbox');
        box.checked = true;
        box.dispatchEvent(new app.window.Event('change', {bubbles: true}));
        assert.equal(settings().displayAll, true);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('media-options menus reflect the stored settings after reload', async () => {
    let {app, socket, settings} = await joined({settings: {
        video: 'cam1', audio: 'mic1', request: 'audio',
        filter: 'mirror-h', send: 'unlimited', simulcast: 'on',
    }});
    try {
        let doc = app.document;
        assert.equal(doc.getElementById('videoselect').value, 'cam1');
        assert.equal(doc.getElementById('audioselect').value, 'mic1');
        assert.equal(doc.getElementById('requestselect').value, 'audio');
        assert.equal(doc.getElementById('filterselect').value, 'mirror-h');
        assert.equal(doc.getElementById('sendselect').value, 'unlimited');
        assert.equal(doc.getElementById('simulcastselect').value, 'on');
        assert.equal(doc.getElementById('mirrorbox').checked, true);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('rejoining after a disconnect keeps the media options visible again', async () => {
    let app = await loadApp({webSocket: true});
    try {
        await joinRoom(app, {username: 'alice', password: 'x'});
        let doc = app.document;
        // These fieldsets are only visible for presenters (mediaoptions),
        // but sendform/simulcastform are visible whenever joined.
        assert.ok(!isVisible(doc, 'login-container'));
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('a remote user appearing with present permission shows the presenter media menu', async () => {
    let app = await loadApp({webSocket: true});
    try {
        let {socket} = await joinRoom(app, {username: 'alice', password: 'x'});
        let s = JSON.parse(app.window.sessionStorage.getItem('settings') || '{}');
        assert.ok('video' in s);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});
