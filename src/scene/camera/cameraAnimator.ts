import {vec3} from 'gl-matrix';
import {Camera} from './camera.ts';

export class CameraAnimator {
    private camera: Camera;

    // Position animation
    private startPos: vec3 = vec3.create();
    private endPos: vec3 = vec3.create();
    private controlPos: vec3 = vec3.create();

    // Target animation
    private startTarget: vec3 = vec3.create();
    private endTarget: vec3 = vec3.create();
    private controlTarget: vec3 = vec3.create();

    private duration: number = 1; // seconds
    private time: number = 0;
    private animating = false;

    constructor(camera: Camera) {
        this.camera = camera;
    }

    /**
     * Starts an animation for both camera position and target.
     * @param toPosition Destination position
     * @param toTarget Destination target
     * @param heightCurve Curve arc height
     * @param duration Animation duration (seconds)
     */
    animateTo(toPosition: vec3, toTarget: vec3, heightCurve = 2, duration = 1) {
        // Store time info
        this.duration = duration;
        this.time = 0;
        this.animating = true;

        // Store positions
        this.startPos = this.camera.getPosition();
        this.endPos = vec3.clone(toPosition);

        this.startTarget = vec3.clone((this.camera as any)['target']); // You can add a getter instead
        this.endTarget = vec3.clone(toTarget);

        // Compute curved control point for position
        const midPos = vec3.lerp(vec3.create(), this.startPos, this.endPos, 0.5);
        const curveOffset = vec3.fromValues(0, heightCurve, 0);
        vec3.add(this.controlPos, midPos, curveOffset);

        // Control point for target (same logic, optional offset)
        const midTarget = vec3.lerp(vec3.create(), this.startTarget, this.endTarget, 0.5);
        const targetOffset = vec3.fromValues(0, heightCurve * 0.5, 0); // smaller curve for target
        vec3.add(this.controlTarget, midTarget, targetOffset);
    }

    update(dt: number) {
        if (!this.animating) return;

        this.time += dt;
        const t = Math.min(this.time / this.duration, 1);

        // Animate position (quadratic Bézier)
        const aPos = vec3.lerp(vec3.create(), this.startPos, this.controlPos, t);
        const bPos = vec3.lerp(vec3.create(), this.controlPos, this.endPos, t);
        const pos = vec3.lerp(vec3.create(), aPos, bPos, t);
        this.camera.setPosition(...pos as [number, number, number]);

        // Animate target (also Bézier)
        const aTar = vec3.lerp(vec3.create(), this.startTarget, this.controlTarget, t);
        const bTar = vec3.lerp(vec3.create(), this.controlTarget, this.endTarget, t);
        const tar = vec3.lerp(vec3.create(), aTar, bTar, t);
        this.camera.setTarget(...tar as [number, number, number]);

        if (t >= 1) {
            this.animating = false;
        }
    }

    isAnimating() {
        return this.animating;
    }
}
