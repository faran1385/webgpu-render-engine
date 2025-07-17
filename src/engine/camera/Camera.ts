import {mat4, vec3} from "gl-matrix";
import {createGPUBuffer, generateID, updateBuffer} from "../../helpers/global.helper.ts";


export interface CameraOptions {
    aspect: number;
    device: GPUDevice;
    initialPosition?: [number, number, number];
    initialTarget?: [number, number, number];
    up?: [number, number, number];
    fov?: number;
    near?: number;
    far?: number;
}


export class Camera {
    private device: GPUDevice;
    private projectionBuffer;
    private viewBuffer;
    private positionBuffer;
    private projectionMatrix: mat4 = mat4.create();
    private viewMatrix: mat4 = mat4.create();
    private up: vec3;
    private aspect: number;
    private fov: number;
    private near: number;
    private far: number;
    readonly id: number;
    private position: vec3;
    private target: vec3;


    constructor(T: CameraOptions) {
        this.device = T.device;
        this.far = T.far ?? 1000
        this.near = T.near ?? .01
        this.fov = T.fov ?? Math.PI / 4
        this.aspect = T.aspect
        this.up = vec3.fromValues(...T.up ?? [0, 1, 0])
        this.position = vec3.fromValues(...T.initialPosition ?? [0, 0, 0]);
        this.target = vec3.fromValues(...T.initialTarget ?? [0, 0, 0]);
        this.id = generateID();
        this.projectionBuffer = createGPUBuffer(this.device, this.projectionMatrix as Float32Array, GPUBufferUsage.UNIFORM, `camera ${this.id} projectionMatrix`);
        this.viewBuffer = createGPUBuffer(this.device, this.viewMatrix as Float32Array, GPUBufferUsage.UNIFORM, `camera ${this.id} viewMatrix`);
        this.positionBuffer = createGPUBuffer(this.device, this.position as Float32Array, GPUBufferUsage.UNIFORM, `camera ${this.id} position Vector`);
        this.updateProjectionMatrix()
        this.updateViewMatrix()
    }

    getBuffers() {
        return {
            projection: this.projectionBuffer,
            view: this.viewBuffer,
            position: this.positionBuffer,
        }
    }

    lookAt(eye: vec3, center: vec3, up: vec3) {
        mat4.lookAt(this.viewMatrix, eye, center, up);
    }

    setTarget(target: [number, number, number]) {
        this.target = vec3.set(this.target, ...target);
    }

    setPosition(position: [number, number, number]) {
        this.position = vec3.set(this.position, ...position)
    }

    setUp(up: [number, number, number]) {
        this.up = vec3.set(this.up, ...up)
    }

    setFar(far: number) {
        this.far = far
    }

    setNear(near: number) {
        this.near = near
    }

    setFov(fov: number) {
        this.fov = fov
    }

    setAspect(aspect: number) {
        this.aspect = aspect;
    }


    updateProjectionMatrix() {
        mat4.perspective(
            this.projectionMatrix,
            this.fov,
            this.aspect,
            this.near,
            this.far
        );
        updateBuffer(this.device, this.projectionBuffer, this.projectionMatrix)
    }

    updateViewMatrix() {
        mat4.lookAt(
            this.viewMatrix,
            this.position,
            this.target,
            this.up
        );

        updateBuffer(this.device, this.viewBuffer, this.viewMatrix)
        updateBuffer(this.device, this.positionBuffer, this.position)
    }

    getViewMatrix() {
        return this.viewMatrix;
    }

    getProjectionMatrix() {
        return this.projectionMatrix;
    }

    getPosition() {
        return this.position
    }

    getTarget() {
        return this.target
    }
}