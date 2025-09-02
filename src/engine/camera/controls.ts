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

    // ... (your existing properties) ...
    private initialPinchDistance = 0;

    private isRotating = false;
    private isZooming = false;

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
            const touches = e.touches;

            if (touches.length === 1) {
                // One finger for rotation
                this.isRotating = true;
                this.lastX = touches[0].clientX;
                this.lastY = touches[0].clientY;
            } else if (touches.length === 2) {
                // Two fingers for zoom
                this.isZooming = true;
                this.initialPinchDistance = Math.hypot(
                    touches[0].clientX - touches[1].clientX,
                    touches[0].clientY - touches[1].clientY
                );
            }
            // Pan logic is not needed for mobile based on the request
        }
    };

    private onTouchEnd = () => {
        if (this.isEnabled) {
            this.isRotating = false;
            this.isZooming = false;
        }
    };

    private onTouchMove = (e: TouchEvent) => {
        if (this.isEnabled) {
            e.preventDefault();
            const touches = e.touches;

            if (this.isRotating && touches.length === 1) {
                const dx = touches[0].clientX - this.lastX;
                const dy = touches[0].clientY - this.lastY;
                this.lastX = touches[0].clientX;
                this.lastY = touches[0].clientY;

                const rotSpeed = 0.005 * this.rotateSpeed;
                this.azimuthVelocity -= dx * rotSpeed;
                this.polarVelocity -= dy * rotSpeed;

            } else if (this.isZooming && touches.length === 2) {
                const currentPinchDistance = Math.hypot(
                    touches[0].clientX - touches[1].clientX,
                    touches[0].clientY - touches[1].clientY
                );

                const pinchScale = currentPinchDistance / this.initialPinchDistance;
                this.distance /= pinchScale;
                this.distance = Math.max(0.1, this.distance);

                this.initialPinchDistance = currentPinchDistance;
            }
            // No pan logic for mobile
        }
    };

    private addEventListeners() {
        // Desktop mouse events
        this.domElement.addEventListener("mousedown", this.onMouseDown);
        this.domElement.addEventListener("mousemove", this.onMouseMove);
        this.domElement.addEventListener("mouseup", this.onMouseUp);
        this.domElement.addEventListener("wheel", this.onWheel, {passive: false});
        this.domElement.addEventListener("contextmenu", e => e.preventDefault());

        // Mobile touch events
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
        this.domElement.removeEventListener("mousedown", this.onMouseDown);
        this.domElement.removeEventListener("mousemove", this.onMouseMove);
        this.domElement.removeEventListener("mouseup", this.onMouseUp);
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
