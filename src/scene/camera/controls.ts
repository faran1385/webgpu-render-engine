import { mat4, vec3 } from "gl-matrix";

export interface OrbitControlsOptions {
    canvas: HTMLCanvasElement;
    initialPosition?: [number, number, number];
    initialTarget?: [number, number, number];
    up?: [number, number, number];
    rotateSpeed?: number;
    zoomSpeed?: number;
    panSpeed?: number;
    dampingFactor?: number;
    fov?: number;
    near?: number;
    far?: number;
    reverseZ?: boolean;
}

export class OrbitControls {
    private canvas: HTMLCanvasElement;
    private position = vec3.create();
    private target = vec3.create();
    private up = vec3.fromValues(0, 1, 0);
    private viewMatrix = mat4.create();
    private projectionMatrix = mat4.create();

    private rotateSpeed: number;
    private zoomSpeed: number;
    private panSpeed: number;
    private dampingFactor: number;
    private fov: number;
    private near: number;
    private far: number;
    private reverseZ: boolean;

    private spherical = { radius: 5, phi: Math.PI / 2, theta: 0 };
    private targetOffset = vec3.create();

    private state: 'NONE' | 'ROTATE' | 'PAN' = 'NONE';
    private pointerLast = { x: 0, y: 0 };
    private enabled: boolean = true;

    constructor(options: OrbitControlsOptions) {
        this.canvas = options.canvas;
        this.rotateSpeed = options.rotateSpeed ?? 0.5;
        this.zoomSpeed = options.zoomSpeed ?? 0.2;
        this.panSpeed = options.panSpeed ?? 0.3;
        this.dampingFactor = options.dampingFactor ?? 0.1;
        this.fov = options.fov ?? Math.PI / 4;
        this.near = options.near ?? 0.1;
        this.far = options.far ?? 1000;
        this.reverseZ = options.reverseZ ?? false;

        vec3.set(
            this.position,
            ...(options.initialPosition ?? [0, 0, 5])
        );
        vec3.set(
            this.target,
            ...(options.initialTarget ?? [0, 0, 0])
        );
        if (options.up) vec3.set(this.up, ...options.up);

        // Initialize spherical from position-target
        const offset = vec3.subtract(vec3.create(), this.position, this.target);
        this.spherical.radius = vec3.length(offset);
        this.spherical.phi = Math.acos(offset[1] / this.spherical.radius);
        this.spherical.theta = Math.atan2(offset[0], offset[2]);

        // Event listeners
        this.attachListeners();

        this.updateMatrices();
    }

    private attachListeners() {
        this.canvas.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mouseup', this.onMouseUp);
        this.canvas.addEventListener('wheel', this.onMouseWheel, { passive: false });
    }

    private detachListeners() {
        this.canvas.removeEventListener('mousedown', this.onMouseDown);
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('mouseup', this.onMouseUp);
        this.canvas.removeEventListener('wheel', this.onMouseWheel);
    }

    public enable() {
        if (!this.enabled) {
            this.enabled = true;
            this.attachListeners();
            const {projectionMatrix} = this.update()
            mat4.perspective(projectionMatrix, Math.PI / 4, window.innerWidth / window.innerHeight, 0.1, 100)
        }
    }

    public disable() {
        if (this.enabled) {
            this.enabled = false;
            this.detachListeners();
            this.state = 'NONE';
        }
    }

    private onMouseDown = (event: MouseEvent) => {
        if (!this.enabled) return;
        event.preventDefault();
        this.pointerLast.x = event.clientX;
        this.pointerLast.y = event.clientY;
        this.state = (event.button === 0) ? 'ROTATE' : 'PAN';
    };

    private onMouseMove = (event: MouseEvent) => {
        if (!this.enabled || this.state === 'NONE') return;
        const dx = event.clientX - this.pointerLast.x;
        const dy = event.clientY - this.pointerLast.y;
        this.pointerLast.x = event.clientX;
        this.pointerLast.y = event.clientY;

        if (this.state === 'ROTATE') {
            this.spherical.theta -= dx * this.rotateSpeed * 0.005;
            this.spherical.phi -= dy * this.rotateSpeed * 0.005;
            this.spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, this.spherical.phi));
        } else if (this.state === 'PAN') {
            const panOffset = vec3.create();
            const xAxis = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), vec3.subtract(vec3.create(), this.position, this.target), this.up));
            const yAxis = vec3.normalize(vec3.create(), this.up);
            vec3.scale(xAxis, xAxis, dx * this.panSpeed * 0.005 * this.spherical.radius);
            vec3.scale(yAxis, yAxis, dy * this.panSpeed * 0.005 * this.spherical.radius);
            vec3.add(panOffset, xAxis, yAxis);
            vec3.add(this.targetOffset, this.targetOffset, panOffset);
        }
        this.updateMatrices();
    };

    private onMouseUp = (_: MouseEvent) => {
        if (!this.enabled) return;
        this.state = 'NONE';
    };

    private onMouseWheel = (event: WheelEvent) => {
        if (!this.enabled) return;
        event.preventDefault();
        const delta = event.deltaY;
        this.spherical.radius += delta * this.zoomSpeed * 0.01;
        this.spherical.radius = Math.max(this.near, Math.min(this.far, this.spherical.radius));
        this.updateMatrices();
    };

    private updateMatrices() {
        // Apply damping to target offset
        vec3.lerp(
            this.target,
            this.target,
            vec3.add(vec3.create(), this.target, this.targetOffset),
            this.dampingFactor
        );
        vec3.scale(this.targetOffset, this.targetOffset, 1 - this.dampingFactor);

        // Spherical to Cartesian
        const sinPhiRadius = Math.sin(this.spherical.phi) * this.spherical.radius;
        this.position[0] = sinPhiRadius * Math.sin(this.spherical.theta) + this.target[0];
        this.position[1] = Math.cos(this.spherical.phi) * this.spherical.radius + this.target[1];
        this.position[2] = sinPhiRadius * Math.cos(this.spherical.theta) + this.target[2];

        // View matrix
        mat4.lookAt(this.viewMatrix, this.position, this.target, this.up);

        // Projection matrix
        const aspect = this.canvas.width / this.canvas.height;
        const f = 1.0 / Math.tan(this.fov / 2);
        mat4.identity(this.projectionMatrix);
        this.projectionMatrix[0] = f / aspect;
        this.projectionMatrix[5] = f;
        this.projectionMatrix[11] = -1;
        this.projectionMatrix[15] = 0;

        if (!this.reverseZ) {
            // standard perspective (near→0, far→1)
            this.projectionMatrix[10] = -(this.far + this.near) / (this.far - this.near);
            this.projectionMatrix[14] = -(2 * this.far * this.near) / (this.far - this.near);
        } else {
            // reversed-Z (near→1, far→0)
            this.projectionMatrix[10] = this.near / (this.far - this.near);
            this.projectionMatrix[14] = (this.far * this.near) / (this.far - this.near);
        }
    }

    /**
     * Call each frame before rendering to update matrices
     */
    public update() {
        return {
            viewMatrix: this.viewMatrix,
            projectionMatrix: this.projectionMatrix,
            position: this.position,
            target: this.target,
        };
    }

    /**
     * Clean up event listeners when disposing controls
     */
    public dispose() {
        this.detachListeners();
    }
}
