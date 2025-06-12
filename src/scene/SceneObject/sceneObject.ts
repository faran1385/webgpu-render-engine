import {mat3, mat4, quat, vec3} from "gl-matrix";
import {Mesh} from "@gltf-transform/core";
import {BaseLayer, ComputeShader, RenderAblePrim} from "../../layers/baseLayer.ts";
import {GeometryData} from "../loader/loaderTypes.ts";
import {createGPUBuffer, updateBuffer} from "../../helpers/global.helper.ts";


type SceneObjectConfig = {
    id: number;
    name?: string;
    nodeIndex: number;

    translation?: vec3;
    rotation?: quat;
    scale?: vec3;
    worldPosition?: mat4;

    parent?: SceneObject;
    mesh?: Mesh;
    primitivesData?: GeometryData[];
};


export class SceneObject {
    id: number;
    name?: string;
    nodeIndex: number;

    translation: vec3;
    rotation: quat;
    scale: vec3;
    worldMatrix: mat4;
    normalMatrix: mat3;
    modelBuffer?: GPUBuffer;
    normalBuffer?: GPUBuffer;

    parent?: SceneObject;
    children: SceneObject[] = [];

    mesh?: Mesh;
    primitives?: RenderAblePrim[];
    primitivesData?: GeometryData[];
    computeShader?: ComputeShader;
    needsUpdate: boolean = false;

    drawCallIndices?: { localPrimitiveIndex: number, drawCallIndex: number, key: "opaque" | "transparent" }[]

    constructor(config: SceneObjectConfig) {
        this.id = config.id;
        this.name = config.name;
        this.nodeIndex = config.nodeIndex;

        this.translation = config.translation ?? vec3.create();
        this.rotation = config.rotation ?? quat.create();
        this.scale = config.scale ?? vec3.fromValues(1, 1, 1);

        this.worldMatrix = config.worldPosition ?? mat4.create();
        this.normalMatrix = mat3.normalFromMat4(mat3.create(), this.worldMatrix);

        this.parent = config.parent;
        this.mesh = config.mesh;
        this.primitivesData = config.primitivesData;

        if (this.primitivesData && this.primitivesData.length > 0) {
            this.primitives = []
        }

        if (this.parent) {
            this.parent.children.push(this);
        }
    }

    appendPrimitive(primitive: RenderAblePrim) {
        if (this.primitives) {
            this.primitives.push(primitive);
        } else {
            throw new Error("This is not a RenderAble Node");
        }
    }

    setTranslation(t: vec3) {
        vec3.copy(this.translation, t);
        this.markTransformDirty();
    }

    setRotation(r: quat) {
        quat.copy(this.rotation, r);
        this.markTransformDirty();
    }

    setScale(s: vec3) {
        vec3.copy(this.scale, s);
        this.markTransformDirty();
    }

    createModelBuffer(device: GPUDevice, matrix: mat4) {
        this.modelBuffer = createGPUBuffer(device, new Float32Array(matrix), GPUBufferUsage.UNIFORM, `${this.name} model buffer`);
    }

    createNormalBuffer(device: GPUDevice, matrix: mat3 | mat4) {
        this.normalBuffer = createGPUBuffer(device, new Float32Array(matrix), GPUBufferUsage.UNIFORM, `${this.name} normal buffer`);
    }

    private markTransformDirty() {
        this.needsUpdate = true;
        BaseLayer._updateQueue.set(this.id, this)
        for (const child of this.children) {
            child.markTransformDirty();
        }
    }

    updateWorldMatrix(device: GPUDevice) {
        const parentMatrix = this.parent?.worldMatrix;
        if (!this.needsUpdate && !parentMatrix) return;

        const localMatrix = mat4.create();

        mat4.fromRotationTranslationScale(localMatrix, this.rotation, this.translation, this.scale);
        if (parentMatrix) {
            mat4.multiply(this.worldMatrix, parentMatrix, localMatrix);
        } else {
            mat4.copy(this.worldMatrix, localMatrix);

        }
        mat3.normalFromMat4(this.normalMatrix, this.worldMatrix);
        this.needsUpdate = false;
        if (this.normalBuffer) {
            updateBuffer(device, this.normalBuffer, new Float32Array(this.normalMatrix))
        }
        if (this.modelBuffer) {
            updateBuffer(device, this.modelBuffer, new Float32Array(this.worldMatrix))
        }
        for (const child of this.children) {
            child.updateWorldMatrix(device);
        }
    }

}
