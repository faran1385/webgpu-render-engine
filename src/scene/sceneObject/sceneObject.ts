import {mat3, mat4, quat, vec3} from "gl-matrix";
import {Mesh, Node, Skin} from "@gltf-transform/core";
import {BaseLayer} from "../../layers/baseLayer.ts";
import {createGPUBuffer, updateBuffer} from "../../helpers/global.helper.ts";
import {Primitive} from "../primitive/Primitive.ts";


type SceneObjectConfig = {
    id: number;
    name?: string;
    nodeIndex: number;
    nodeReference: Node

    translation?: vec3;
    rotation?: quat;
    scale?: vec3;
    worldPosition?: mat4;

    parent?: SceneObject;
    mesh?: Mesh;
};

type SceneObjectMatrix = {
    matrix: mat4,
    scale: vec3,
    translation: vec3,
    rotation: quat
}


export class SceneObject {
    id: number;
    name?: string;
    nodeIndex: number;
    nodeReference: Node

    modelBuffer?: GPUBuffer;
    normalBuffer?: GPUBuffer;
    animationMatrix: SceneObjectMatrix;
    transformMatrix: SceneObjectMatrix;

    localMatrix: mat4;
    worldMatrix: mat4;
    normalMatrix: mat3;

    parent?: SceneObject;
    children: SceneObject[] = [];

    // draw
    mesh?: Mesh;
    primitives?: Map<number, Primitive> = new Map();
    needsUpdate: boolean = false;


    // compute shader
    lodSelectionThreshold: number | undefined = undefined;
    frustumCullingMinMax: { min: [number, number, number], max: [number, number, number] } | undefined = undefined;

    // animations
    skin?: Skin
    skinBuffer?: GPUBuffer


    constructor(config: SceneObjectConfig) {
        this.id = config.id;
        this.name = config.name;
        this.nodeIndex = config.nodeIndex;
        this.nodeReference = config.nodeReference;

        const scale = config.nodeReference.getScale()
        const rotation = config.nodeReference.getRotation();
        const translation = config.nodeReference.getTranslation()
        this.animationMatrix = {
            scale,
            translation,
            rotation,
            matrix: mat4.fromRotationTranslationScale(mat4.create(), quat.fromValues(...rotation), translation, scale)
        }
        this.transformMatrix = {
            matrix: mat4.create(),
            scale: vec3.create(),
            translation: vec3.create(),
            rotation: quat.create()
        }
        this.localMatrix = mat4.create()
        this.worldMatrix = mat4.create()
        this.normalMatrix = mat3.normalFromMat4(mat3.create(), this.worldMatrix);


        this.skin = config.nodeReference.getSkin() ?? undefined;

        this.parent = config.parent;
        this.mesh = config.mesh;
    }

    setLodSelectionThreshold(threshold: number): void {
        this.lodSelectionThreshold = threshold;
    }

    appendPrimitive(primitive: Primitive) {
        if (this.primitives) {
            this.primitives.set(primitive.id, primitive);
        } else {
            throw new Error("This is not a RenderAble Node");
        }
    }

    createModelBuffer(device: GPUDevice, matrix: mat4) {
        this.modelBuffer = createGPUBuffer(device, new Float32Array(matrix), GPUBufferUsage.UNIFORM, `${this.name} model buffer`);
    }

    createNormalBuffer(device: GPUDevice, matrix: mat3 | mat4) {
        this.normalBuffer = createGPUBuffer(device, new Float32Array(matrix), GPUBufferUsage.UNIFORM, `${this.name} normal buffer`);
    }

    setTranslation(matrix: SceneObjectMatrix, pos: vec3) {
        vec3.copy(matrix.translation, pos);
        this._updateMatrix(matrix);
    }

    setRotation(matrix: SceneObjectMatrix, rot: quat) {
        quat.copy(matrix.rotation, rot);
        this._updateMatrix(matrix);
    }

    setScale(matrix: SceneObjectMatrix, scale: vec3) {
        vec3.copy(matrix.scale, scale);
        this._updateMatrix(matrix);
    }

    private _updateMatrix(matrix: SceneObjectMatrix) {
        mat4.fromRotationTranslationScale(matrix.matrix, matrix.rotation, matrix.translation, matrix.scale);
        this.markTransformDirty();
    }

    public getPosition() {

        const pos = vec3.create();
        mat4.getTranslation(pos, this.worldMatrix);
        return [...pos];
    }


    markTransformDirty() {
        this.needsUpdate = true;
        BaseLayer._sceneObjectUpdateQueue.set(this.id, this)
        for (const child of this.children) {
            child.markTransformDirty();
        }
    }

    updateWorldMatrix(device: GPUDevice | undefined = undefined) {
        const parentMatrix = this.parent?.worldMatrix;
        if (!this.needsUpdate && parentMatrix) return;

        mat4.multiply(this.localMatrix, this.animationMatrix.matrix, this.transformMatrix.matrix);
        if (parentMatrix) {
            mat4.multiply(this.worldMatrix, parentMatrix, this.localMatrix)
        } else {
            mat4.copy(this.worldMatrix, this.localMatrix);
        }
        this.needsUpdate = false;
        device ? this.updateBuffers(device) : "";
        for (const child of this.children) {
            child.updateWorldMatrix(device);
        }
    }

    updateBuffers(device: GPUDevice) {
        mat3.normalFromMat4(this.normalMatrix, this.worldMatrix);
        if (this.normalBuffer && device) {
            updateBuffer(device, this.normalBuffer, new Float32Array(this.normalMatrix))
        }
        if (this.modelBuffer && device) {
            updateBuffer(device, this.modelBuffer, new Float32Array(this.worldMatrix))
        }
    }
}
