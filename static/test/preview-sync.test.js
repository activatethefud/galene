import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, waitFor, isVisible, hasClass} from './harness.js';

async function joinButtonState(app, id) {
    let elt = app.document.getElementById(id);
    let icon = elt.querySelector('.fas');
    return {
        off: hasClass(elt, 'off'),
        on: hasClass(elt, 'on'),
        pressed: elt.getAttribute('aria-pressed'),
        icon: icon.className,
    };
}

/**
 * Overrides getUserMedia so that the next call returns a promise that the
 * test resolves manually.  Restores the harness stub once the first call
 * is made, so any follow-up acquisition (e.g. a re-run after a toggle) goes
 * through the normal fast stub.
 */
function holdNextGetUserMedia(window) {
    let mediaDevices = window.navigator.mediaDevices;
    let original = mediaDevices.getUserMedia;
    let next;
    let pending = new Promise(function(resolve) {
        next = resolve;
    });
    mediaDevices.getUserMedia = async function(constraints) {
        mediaDevices.getUserMedia = original;
        await pending;
        return window.__makeStream(!!constraints.audio, !!constraints.video);
    };
    return {
        release() {
            next();
        },
    };
}

test('toggling both buttons off while a preview is being acquired hides the preview', async function() {
    const app = await loadApp({});
    try {
        const doc = app.document;
        const win = app.window;
        // Both buttons on, live preview shown, acquisition settled.
        assert.equal(isVisible(doc, 'login-preview'), true);
        assert.equal((await joinButtonState(app, 'join-cambutton')).on, true);
        assert.equal((await joinButtonState(app, 'join-micbutton')).on, true);

        // Start a preview acquisition that we hold open, then turn both
        // devices off while getUserMedia is still pending.
        let hold = holdNextGetUserMedia(win);
        let pending = win.updateLoginPreview();
        await new Promise((r) => setTimeout(r, 0));
        win.toggleCamera();
        win.toggleMicrophone();
        await new Promise((r) => setTimeout(r, 0));

        // Buttons must already be off.
        let cam = await joinButtonState(app, 'join-cambutton');
        let mic = await joinButtonState(app, 'join-micbutton');
        assert.equal(cam.on, false);
        assert.equal(cam.off, true);
        assert.equal(mic.on, false);
        assert.equal(mic.off, true);

        // Let the held acquisition finish.
        hold.release();
        await pending;
        await waitFor(
            () => !isVisible(doc, 'login-preview'),
            'preview should be hidden after both buttons are off: ' +
                JSON.stringify(app.errors));
        assert.equal(isVisible(doc, 'login-video'), false);
        assert.equal(isVisible(doc, 'login-audio-only'), false);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('turning the camera off while acquiring keeps an audio-only preview', async function() {
    const app = await loadApp({});
    try {
        const doc = app.document;
        const win = app.window;

        let hold = holdNextGetUserMedia(win);
        let pending = win.updateLoginPreview();
        await new Promise((r) => setTimeout(r, 0));
        win.toggleCamera();
        await new Promise((r) => setTimeout(r, 0));

        let cam = await joinButtonState(app, 'join-cambutton');
        let mic = await joinButtonState(app, 'join-micbutton');
        assert.equal(cam.on, false);
        assert.equal(mic.on, true);

        hold.release();
        await pending;
        await waitFor(
            () => isVisible(doc, 'login-audio-only'),
            'audio-only panel should be shown after the camera is off: ' +
                JSON.stringify(app.errors));
        assert.equal(isVisible(doc, 'login-video'), false);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});
