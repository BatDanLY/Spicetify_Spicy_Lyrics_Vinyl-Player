// =============================================================================
//  Spicetify Spicy Lyrics Vinyl-Player
//  Transforms the album art into a Vinyl record
//  Rotates album art with song progress and supports vinyl-style drag-to-scrub.
//  Inspired by the spinning disc in Instagram stories.
// =============================================================================

/** Total number of full rotations the disc makes over the whole track. */
const ROTATIONS_PER_SONG = 4;

/**
 * How many degrees of drag = one full track length.
 * 3600° of arc → one full song. Feels natural without being too sensitive.
 */
const DRAG_DEGREES_PER_TRACK = 1440;

/** Minimum pixel movement before a mousedown is treated as a drag (not a click). */
const DRAG_THRESHOLD_PX = 4;

/** CSS class applied while the user is actively dragging. */
const DRAGGING_CLASS = "vinyl-dragging";

/** requestAnimationFrame handle so we can cancel cleanly. */
let animFrameId: number | null = null;

/** Tracks the current rotation angle in degrees (accumulates across progress). */
let currentDegrees = 0;

/** Whether music was playing before the drag started (so we can restore it). */
let wasPlayingBeforeDrag = false;

/** Weak references to the currently observed elements – lets us detect replacements. */
let activeImageContainer: Element | null = null;
let activeMediaBox: Element | null = null;

/** MutationObserver watching the player area for DOM swaps. */
let domObserver: MutationObserver | null = null;

/** List of music note characters for Particles */
const musicNotes = ["♪", "♫", "♬", "♩"];

/** Counter used to reduce note count */
let musicNoteCounter = 0;

/** Lower means more note particles */
const musicNoteAmount = 3;

/** Stores Particles for reuse */
const particlePool: HTMLDivElement[] = [];

/** Hard limit on particle count */
const MAX_POOL_SIZE = 30;


interface DragState {
    isPointerDown: boolean;
    active: boolean;
    lastAngle: number;
    totalAngleDelta: number;
    startProgress: number;
    centerX: number;
    centerY: number;
    totalMovement: number;
    startX: number;
    startY: number;
}

let drag: DragState = {
    isPointerDown: false,
    active: false,
    lastAngle: 0,
    totalAngleDelta: 0,
    startProgress: 0,
    centerX: 0,
    centerY: 0,
    totalMovement: 0,
    startX: 0,
    startY: 0,
};

function getParticle(): HTMLDivElement {
    let particle = particlePool.pop();

    if (!particle) {
        particle = document.createElement("div");

        particle.style.position = "fixed";
        particle.style.pointerEvents = "none";
        particle.style.color = "white";
        particle.style.zIndex = "999999";
        particle.style.willChange = "transform, opacity";

        document.body.appendChild(particle);
    }

    particle.style.display = "block";

    return particle;
}

function releaseParticle(particle: HTMLDivElement): void {
    particle.style.display = "none";

    if (particlePool.length < MAX_POOL_SIZE) {
        particlePool.push(particle);
    } else {
        particle.remove();
    }
}

function spawnMusicNote(x: number, y: number): void {
    const seed = Math.random();

    const note = getParticle();

    note.textContent =
        musicNotes[(seed * musicNotes.length) | 0];

    note.style.fontSize = `${50 + seed * 12}px`;

    note.style.transform = `translate(${x}px, ${y}px)`;

    const angle = (seed - 0.5) * Math.PI;
    const distance = 50 + seed * 50;

    const animation = note.animate(
        [
            {
                transform: `translate(${x}px, ${y}px) scale(1)`,
                opacity: 1,
            },
            {
                transform: `translate(${
                    x + Math.cos(angle) * distance
                }px, ${
                    y - distance
                }px) scale(1.5)`,
                opacity: 0,
            },
        ],
        {
            duration: 1000,
            easing: "ease-out",
        }
    );

    animation.onfinish = () => {
        releaseParticle(note);
    };
}

function angleToCursor(
    clientX: number,
    clientY: number,
    centerX: number,
    centerY: number,
): number {
    const rad = Math.atan2(clientY - centerY, clientX - centerX);
    const deg = (rad * 180) / Math.PI + 90; // rotate so 0° = 12-o'clock
    return ((deg % 360) + 360) % 360;       // normalise to [0, 360)
}

function shortestArcDelta(from: number, to: number): number {
    let delta = to - from;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return delta;
}

function applyRotation(el: Element | null, degrees: number, instant = false): void {
    if (!el) return;
    (el as HTMLElement).style.transform = `rotate(${degrees}deg)`;
    (el as HTMLElement).style.willChange = "transform";
    (el as HTMLElement).style.transition = instant ? "none": "transform 0.4s linear";
}

function angleToProgress(totalAngleDelta: number): number {
    const duration = Spicetify.Player.getDuration?.() ?? 0;
    const progressDelta = (totalAngleDelta / DRAG_DEGREES_PER_TRACK) * duration;
    return Math.max(0, Math.min(duration, drag.startProgress + progressDelta));
}

function updateTimeline(progressMs: number): void {
    const duration = Spicetify.Player.getDuration?.() ?? 0;
    if (duration <= 0) return;

    const fraction = Math.max(0, Math.min(1, progressMs / duration));

    const sliderBar = document.querySelector<HTMLElement>(".SliderBar");
    if (sliderBar) {
        sliderBar.style.setProperty("--SliderProgress", String(fraction));
    }

    const positionEl = document.querySelector<HTMLElement>(".Time.Position");
    if (positionEl) {
        const totalSec = Math.floor(progressMs / 1000);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        positionEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
    }
}

function startAnimationLoop(): void {
    if (animFrameId !== null) return;

    function tick(): void {
        if (!activeImageContainer) {
            animFrameId = null;
            return;
        }

        const progress = Spicetify.Player.getProgress?.() ?? 0;
        const duration = Spicetify.Player.getDuration?.() ?? 1;
        const fraction = duration > 0 ? progress / duration : 0;

        currentDegrees = fraction * ROTATIONS_PER_SONG * 360;
        applyRotation(activeImageContainer, currentDegrees);

        animFrameId = requestAnimationFrame(tick);
    }

    animFrameId = requestAnimationFrame(tick);
}

function stopAnimationLoop(): void {
    if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
}

function onWindowPointerMove(e: PointerEvent): void {
    if (!drag.isPointerDown) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    drag.totalMovement = Math.sqrt(dx * dx + dy * dy);

    if (!drag.active && drag.totalMovement >= DRAG_THRESHOLD_PX) {
        drag.active = true;
        wasPlayingBeforeDrag = Spicetify.Player.isPlaying?.() ?? false;
        if (wasPlayingBeforeDrag) {
            Spicetify.Player.pause();
        }
        stopAnimationLoop();
        document.body.classList.add(DRAGGING_CLASS);
    }

    if (!drag.active) return;


    const currentAngle = angleToCursor(e.clientX, e.clientY, drag.centerX, drag.centerY);
    const stepDelta = shortestArcDelta(drag.lastAngle, currentAngle);
    drag.lastAngle = currentAngle;
    drag.totalAngleDelta += stepDelta;

    const startDegrees = (drag.startProgress / (Spicetify.Player.getDuration?.() ?? 1))
        * ROTATIONS_PER_SONG * 360;
    const visualDelta = (drag.totalAngleDelta / DRAG_DEGREES_PER_TRACK) * ROTATIONS_PER_SONG * 360;
    currentDegrees = startDegrees + visualDelta;
    applyRotation(activeImageContainer, currentDegrees, true);

    if (musicNoteCounter == 0) {
        spawnMusicNote(e.clientX, e.clientY);
        musicNoteCounter = musicNoteAmount;
    } else {
        musicNoteCounter -= 1;
    }

    updateTimeline(angleToProgress(drag.totalAngleDelta));
}

function onWindowPointerUp(_e: PointerEvent): void {
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);

    if (!drag.active) {
        resetDragState();
        return;
    }

    const finalProgress = angleToProgress(drag.totalAngleDelta);
    const finalDegrees = currentDegrees;

    resetDragState();

    applyRotation(activeImageContainer, finalDegrees, true);

    Spicetify.Player.seek(finalProgress);

    setTimeout(function(){
        if (wasPlayingBeforeDrag) {
            Spicetify.Player.play();
        }
        startAnimationLoop();
    }, 60);
    document.body.classList.remove(DRAGGING_CLASS);
}

function onMediaBoxPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;

    const imageContainer = activeImageContainer as HTMLElement | null;
    if (!imageContainer) return;

    const rect = imageContainer.getBoundingClientRect();

    if (
        e.clientX < rect.left  ||
        e.clientX > rect.right ||
        e.clientY < rect.top   ||
        e.clientY > rect.bottom
    ) {
        return;
    }

    const centerX = rect.left + rect.width  / 2;
    const centerY = rect.top  + rect.height / 2;
    const startAngle = angleToCursor(e.clientX, e.clientY, centerX, centerY);

    drag = {
        isPointerDown: true,
        active: false,
        lastAngle: startAngle,
        totalAngleDelta: 0,
        startProgress: Spicetify.Player.getProgress?.() ?? 0,
        centerX,
        centerY,
        totalMovement: 0,
        startX: e.clientX,
        startY: e.clientY,
    };

    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
}

function resetDragState(): void {
    drag = {
        isPointerDown: false,
        active: false,
        lastAngle: 0,
        totalAngleDelta: 0,
        startProgress: 0,
        centerX: 0,
        centerY: 0,
        totalMovement: 0,
        startX: 0,
        startY: 0,
    };
}

function attachListeners(mediaBox: HTMLElement, imageContainer: HTMLElement): void {
    mediaBox.addEventListener("pointerdown", onMediaBoxPointerDown as EventListener);
    imageContainer.addEventListener("dragstart", (e) => e.preventDefault());

    imageContainer.style.cursor = "grab";
    imageContainer.style.userSelect = "none";
    imageContainer.style.touchAction = "none";
}

function injectStyles(): void {
    const id = "vinyl-spin-styles";
    if (document.getElementById(id)) return;

    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
    body.${DRAGGING_CLASS},
    body.${DRAGGING_CLASS} * {
        cursor: grabbing !important;
    }

    body.${DRAGGING_CLASS} .MediaImageContainer {
        filter: brightness(1.08);
    }

    .MediaImageContainer {
        border-radius: 50% !important;
        overflow: hidden !important;
        transform-origin: center center !important;
        pointer-events: auto !important;
        box-shadow: 0px 10px 50px 16px rgba(0,0,0,0.15)!important;
    }
    
    .MediaImageContainer::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 14%;
        height: 14%;
        border-radius: 50%;
        pointer-events: none;
        z-index: 2;

        background:
            radial-gradient(
                circle at center,
                rgba(24, 22, 35, 0.9) 0%,
                rgba(24, 22, 35, 0.9) 38%,
                rgba(255, 255, 255, 0.1) 38%,
                rgba(255, 255, 255, 0.1) 40%,
                rgba(24, 22, 35, 0.9) 40%,
                rgba(24, 22, 35, 0.9) 100%
            ),
            repeating-radial-gradient(
                circle at center,
                rgba(255,255,255,0.1) 0,
                rgba(255,255,255,0.1) 1px,
                transparent 1px,
                transparent 4px
            );

        box-shadow:
            0 0 10px rgba(0,0,0,0.3) inset,
            0 0 20px rgba(255,255,255,0.1);
    }

    .MediaImageContainer::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 50%;
        pointer-events: none;
    
        background:
            radial-gradient(
                circle,
                transparent 0%,
                transparent 70%,
                rgba(0,0,0,0.15) 70.5%,
                rgba(0,0,0,0.15) 100%
            ),
            repeating-radial-gradient(
                circle,
                transparent 70%,
                transparent 71%,
                rgba(255,255,255,0.08) 71.2%,
                rgba(255,255,255,0.08) 71.4%,
                transparent 71.6%,
                transparent 72%
            );
    
        mix-blend-mode: overlay;
    }
    `;
    document.head.appendChild(style);
}

function bindElements(): void {
    const imageContainer = document.querySelector(".MediaImageContainer");
    const mediaBox = document.querySelector(".MediaBox");

    if (imageContainer === activeImageContainer && mediaBox === activeMediaBox) {
        return;
    }

    activeImageContainer = imageContainer;
    activeMediaBox = mediaBox as Element | null;

    if (mediaBox && imageContainer) {
        attachListeners(mediaBox as HTMLElement, imageContainer as HTMLElement);
    }

    startAnimationLoop();
}

function startDOMObserver(): void {
    if (domObserver) return;

    const target = document.querySelector(".Root__now-playing-bar") ?? document.body;

    domObserver = new MutationObserver(() => {
        bindElements();
    });

    domObserver.observe(target, { childList: true, subtree: true });
}

function onSongChange(): void {
    currentDegrees = 0;
    applyRotation(activeImageContainer, 0, true);
}

function onPlayPause(event?: Event & { data?: boolean }): void {
    if (drag.active) return;
    const isPlaying = event?.data ?? false;
    if (isPlaying) {
        startAnimationLoop();
    } else {
        stopAnimationLoop();
    }
}

async function main(): Promise<void> {
    while (!Spicetify?.showNotification || !Spicetify?.Player?.addEventListener) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }

    injectStyles();
    startDOMObserver();
    bindElements();

    Spicetify.Player.addEventListener("songchange", onSongChange);
    Spicetify.Player.addEventListener("onplaypause", onPlayPause as EventListener);

    startAnimationLoop();

    Spicetify.showNotification(
        "Vinyl Scrubbing Enabled"
    );
}

export default main;