import {vec3} from "gl-matrix";
import {Camera} from "./Camera.ts";

// Utility to convert Cartesian offset to spherical coordinates
function cartesianToSpherical(offset: vec3) {
    const radius = vec3.length(offset);
    const polar = Math.acos(offset[1] / radius);           // phi
    const azimuth = Math.atan2(offset[0], offset[2]);     // theta
    return {radius, polar, azimuth};
}

export class OrbitControls {
    private target: vec3;
    private distance: number;
    private isEnabled: boolean = true;

    private azimuth: number;
    private polar: number;

    private azimuthVelocity = 0;
    private polarVelocity = 0;
    private panOffset = vec3.create();

    private isDragging = false;
    private isPanning = false;
    private lastX = 0;
    private lastY = 0;

    // === Configurable Parameters ===
    dampingFactor = 0.1;
    rotateSpeed = 0.1;
    zoomSpeed = 0.5;
    panSpeed = 1.0;

    constructor(
        private camera: Camera,
        private domElement: HTMLElement
    ) {

        this.target = vec3.clone(this.camera.getTarget());
        const offset = vec3.sub(vec3.create(), this.camera.getPosition(), this.target);
        const spherical = cartesianToSpherical(offset);
        this.distance = spherical.radius;
        this.azimuth = spherical.azimuth;
        this.polar = spherical.polar;

        this.addEventListeners();

    }

    private onTouchStart = (e: TouchEvent) => {
        if (this.isEnabled) {
            e.preventDefault();
            // Handle a single finger for rotation
            if (e.touches.length === 1) {
                this.isDragging = true;
                this.lastX = e.touches[0].clientX;
                this.lastY = e.touches[0].clientY;
                this.isPanning = false; // A single touch is for rotation
            } else if (e.touches.length === 2) {
                // Handle two fingers for pan/zoom
                this.isPanning = true;
                this.isDragging = false; // Dragging state is handled differently for multi-touch
            }
        }
    };

    private onTouchEnd = () => {
        if (this.isEnabled) {
            this.isDragging = false;
            this.isPanning = false;
        }
    };

    private onTouchMove = (e: TouchEvent) => {
        if (this.isEnabled) {
            e.preventDefault();
            const touches = e.touches;

            if (touches.length === 1 && this.isDragging) {
                // Single-finger rotation logic (similar to mouse drag)
                const dx = touches[0].clientX - this.lastX;
                const dy = touches[0].clientY - this.lastY;
                this.lastX = touches[0].clientX;
                this.lastY = touches[0].clientY;

                const rotSpeed = 0.005 * this.rotateSpeed;
                this.azimuthVelocity -= dx * rotSpeed;
                this.polarVelocity -= dy * rotSpeed;
            } else if (touches.length === 2) {
                // Two-finger gesture for pan and zoom
                const touch1 = touches[0];
                const touch2 = touches[1];

                // Calculate the midpoint for panning
                const currentMidX = (touch1.clientX + touch2.clientX) / 2;
                const currentMidY = (touch1.clientY + touch2.clientY) / 2;
                const prevMidX = (this.lastX + this.lastY) / 2;
                const prevMidY = (this.lastY + this.lastY) / 2;

                const dx = currentMidX - prevMidX;
                const dy = currentMidY - prevMidY;
                this.lastX = currentMidX;
                this.lastY = currentMidY;

                const width = this.domElement.clientWidth;
                const height = this.domElement.clientHeight;

                // Pan logic
                const panX = -dx * this.panSpeed * (this.distance / width);
                const panY = dy * this.panSpeed * (this.distance / height);
                const up = vec3.fromValues(0, 1, 0);
                const right = vec3.create();
                const viewDir = vec3.sub(vec3.create(), this.camera.getPosition(), this.target);
                vec3.cross(right, up, viewDir);
                vec3.normalize(right, right);
                const actualUp = vec3.cross(vec3.create(), viewDir, right);
                vec3.normalize(actualUp, actualUp);
                vec3.scaleAndAdd(this.panOffset, this.panOffset, right, panX);
                vec3.scaleAndAdd(this.panOffset, this.panOffset, actualUp, panY);

                // Zoom logic (pinch gesture)
                const prevDistance = Math.hypot(this.lastX - this.lastX, this.lastY - this.lastY);
                const currentDistance = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
                const zoomDelta = (currentDistance - prevDistance) * this.zoomSpeed * 0.001;
                this.distance = Math.max(0.1, this.distance - zoomDelta);
            }
        }
    };

    private addEventListeners() {
        this.domElement.addEventListener("mousedown", this.onMouseDown);
        this.domElement.addEventListener("mousemove", this.onMouseMove);
        this.domElement.addEventListener("mouseup", this.onMouseUp);
        this.domElement.addEventListener("wheel", this.onWheel, {passive: false});
        this.domElement.addEventListener("contextmenu", e => e.preventDefault());

        this.domElement.addEventListener("touchstart", this.onTouchStart, {passive: false});
        this.domElement.addEventListener("touchmove", this.onTouchMove, {passive: false});
        this.domElement.addEventListener("touchend", this.onTouchEnd);
    }

    private onMouseDown = (e: MouseEvent) => {
        if (this.isEnabled) {
            this.isDragging = true;
            this.lastX = e.clientX;
            this.lastY = e.clientY;
            this.isPanning = e.button === 2 || e.shiftKey;
        }
    };

    private onMouseMove = (e: MouseEvent) => {
        if (this.isEnabled) {
            if (!this.isDragging) return;

            const dx = e.clientX - this.lastX;
            const dy = e.clientY - this.lastY;
            this.lastX = e.clientX;
            this.lastY = e.clientY;

            const width = this.domElement.clientWidth;
            const height = this.domElement.clientHeight;

            if (this.isPanning) {
                const panX = -dx * this.panSpeed * (this.distance / width);
                const panY = dy * this.panSpeed * (this.distance / height);

                const up = vec3.fromValues(0, 1, 0);
                const right = vec3.create();
                const viewDir = vec3.sub(vec3.create(), this.camera.getPosition(), this.target);
                vec3.cross(right, up, viewDir);
                vec3.normalize(right, right);

                const actualUp = vec3.cross(vec3.create(), viewDir, right);
                vec3.normalize(actualUp, actualUp);

                vec3.scaleAndAdd(this.panOffset, this.panOffset, right, panX);
                vec3.scaleAndAdd(this.panOffset, this.panOffset, actualUp, panY);
            } else {
                const rotSpeed = 0.005 * this.rotateSpeed;
                this.azimuthVelocity -= dx * rotSpeed;
                this.polarVelocity -= dy * rotSpeed;
            }
        }
    };

    private onMouseUp = () => {
        if (this.isEnabled){
            this.isDragging = false;
            this.isPanning = false;
        }
    };

    private onWheel = (e: WheelEvent) => {
        if(this.isEnabled){
            e.preventDefault();
            const zoom = 1 + e.deltaY * this.zoomSpeed * 0.001;
            this.distance = Math.max(0.1, this.distance * zoom);
        }
    };

    update() {
        if(this.isEnabled){
            // === Damping ===
            this.azimuth += this.azimuthVelocity;
            this.polar += this.polarVelocity;

            this.azimuthVelocity *= 1 - this.dampingFactor;
            this.polarVelocity *= 1 - this.dampingFactor;

            const epsilon = 0.001;
            this.polar = Math.max(epsilon, Math.min(Math.PI - epsilon, this.polar));

            // === Apply Pan Offset ===
            vec3.add(this.target, this.target, this.panOffset);
            vec3.set(this.panOffset, 0, 0, 0);

            // === Update Camera Position ===
            this.updateCamera();
        }
    }

    private updateCamera() {
        const sinPhi = Math.sin(this.polar);
        const x = this.distance * sinPhi * Math.sin(this.azimuth);
        const y = this.distance * Math.cos(this.polar);
        const z = this.distance * sinPhi * Math.cos(this.azimuth);

        const position = vec3.fromValues(x, y, z);
        vec3.add(position, position, this.target);

        this.camera.setPosition([position[0], position[1], position[2]])
        this.camera.setTarget([this.target[0], this.target[1], this.target[2]]);
        this.camera.updateViewMatrix();
    }

    dispose() {
        this.domElement.removeEventListener("pointerdown", this.onMouseDown);
        this.domElement.removeEventListener("pointermove", this.onMouseMove);
        this.domElement.removeEventListener("pointerup", this.onMouseUp);
        this.domElement.removeEventListener("wheel", this.onWheel);
        this.domElement.removeEventListener("contextmenu", e => e.preventDefault());

        this.domElement.removeEventListener("touchstart", this.onTouchStart);
        this.domElement.removeEventListener("touchmove", this.onTouchMove);
        this.domElement.removeEventListener("touchend", this.onTouchEnd);
    }

    setTarget(x: number, y: number, z: number) {
        vec3.set(this.target, x, y, z);
    }

    setDistance(d: number) {
        this.distance = d;
    }

    enable(){
        this.isEnabled = true;
    }

    disable(){
        this.isEnabled = false;
    }
}
