import {mat4, vec3} from 'gl-matrix';

export interface CameraOptions {
    position?: vec3;
    target?: vec3;
    up?: vec3;
    fovYRadians?: number;
    aspectRatio?: number;
    near?: number;
    far?: number;
}

/**
 * Camera class providing view and projection matrices for a 3D scene,
 * with built-in window-resize handling for canvas element.
 */
export class Camera {
    // Position and orientation
    private position: vec3;
    private target: vec3;
    private up: vec3;

    // Projection parameters
    private fovY: number;
    private aspect: number;
    private near: number;
    private far: number;

    // Cached matrices
    private viewMatrix: mat4;
    private projectionMatrix: mat4;
    private viewProjMatrix: mat4;
    private dirtyView: boolean;
    private dirtyProj: boolean;

    constructor(options: CameraOptions = {}) {
        this.position = vec3.clone(options.position ?? [0, 0, 5] as any);
        this.target = vec3.clone(options.target ?? [0, 0, 0] as any);
        this.up = vec3.clone(options.up ?? [0, 1, 0] as any);

        this.fovY = options.fovYRadians ?? Math.PI / 4;
        this.aspect = options.aspectRatio ?? 1;
        this.near = options.near ?? 0.1;
        this.far = options.far ?? 1000;

        this.viewMatrix = mat4.create();
        this.projectionMatrix = mat4.create();
        this.viewProjMatrix = mat4.create();

        this.dirtyView = true;
        this.dirtyProj = true;
    }

    /** Mark view dirty when position, target, or up changes */
    private markViewDirty() {
        this.dirtyView = true;
    }

    /** Mark projection dirty when fov, aspect, near, or far changes */
    private markProjDirty() {
        this.dirtyProj = true;
    }

    /** Set camera position */
    public setPosition(x: number, y: number, z: number) {
        vec3.set(this.position, x, y, z);
        this.markViewDirty();
    }

    /** Get current camera position */
    getPosition(): vec3 {
        return vec3.clone(this.position);
    }

    /** Set camera target */
    setTarget(x: number, y: number, z: number) {
        vec3.set(this.target, x, y, z);
        this.markViewDirty();
    }

    /** Set up vector */
    setUp(x: number, y: number, z: number) {
        vec3.set(this.up, x, y, z);
        this.markViewDirty();
    }

    /** Update aspect ratio, e.g. on resize */
    setAspect(aspect: number) {
        this.aspect = aspect;
        this.markProjDirty();
    }

    /** Update field of view */
    setFovY(fovYRadians: number) {
        this.fovY = fovYRadians;
        this.markProjDirty();
    }

    /** Update near and far planes */
    setClippingPlanes(near: number, far: number) {
        this.near = near;
        this.far = far;
        this.markProjDirty();
    }

    /** Attach a resize listener to update aspect ratio based on a canvas element */
    attachToCanvas(canvas: HTMLCanvasElement) {
        const resizeHandler = () => {
            canvas.width = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
            this.setAspect(canvas.width / canvas.height);
        };
        // Initial aspect
        resizeHandler();
        window.addEventListener('resize', resizeHandler);
    }

    /** Compute or return cached view matrix */
    getViewMatrix(): mat4 {
        if (this.dirtyView) {
            mat4.lookAt(this.viewMatrix, this.position, this.target, this.up);
            this.dirtyView = false;
        }
        return this.viewMatrix;
    }

    /** Compute or return cached projection matrix */
    getProjectionMatrix(): mat4 {
        if (this.dirtyProj) {
            mat4.perspective(
                this.projectionMatrix,
                this.fovY,
                this.aspect,
                this.near,
                this.far,
            );
            this.dirtyProj = false;
        }
        return this.projectionMatrix;
    }

    /** Compute or return cached view-projection matrix */
    getViewProjectionMatrix(): mat4 {
        this.getViewMatrix();
        this.getProjectionMatrix();
        mat4.multiply(this.viewProjMatrix, this.getProjectionMatrix(), this.getViewMatrix());
        return this.viewProjMatrix;
    }
}
