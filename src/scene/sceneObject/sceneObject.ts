import {mat3, mat4, quat, vec3} from "gl-matrix";
import {Mesh, Node, Skin} from "@gltf-transform/core";
import {BaseLayer, RenderAblePrim} from "../../layers/baseLayer.ts";
import {GeometryData} from "../loader/loaderTypes.ts";
import {createGPUBuffer, makePrimitiveKey, updateBuffer} from "../../helpers/global.helper.ts";


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
    primitivesData?: GeometryData[];
};


export class SceneObject {
    id: number;
    name?: string;
    nodeIndex: number;
    nodeReference: Node

    modelBuffer?: GPUBuffer;
    normalBuffer?: GPUBuffer;
    animationMatrix: mat4;
    transformMatrix: mat4;
    localMatrix: mat4;
    worldMatrix: mat4;
    normalMatrix: mat3;

    parent?: SceneObject;
    children: SceneObject[] = [];

    // draw
    mesh?: Mesh;
    primitives?: Map<string, RenderAblePrim> = new Map();
    primitivesData: Map<number, GeometryData> = new Map();
    needsUpdate: boolean = false;
    indexBufferStartIndex: Map<number, number> = new Map();
    indirectBufferStartIndex: Map<string, number> = new Map();

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
        this.animationMatrix = mat4.fromRotationTranslationScale(mat4.create(), quat.fromValues(...rotation), translation, scale);
        this.transformMatrix = mat4.create()
        this.localMatrix = mat4.create()
        this.worldMatrix = mat4.create()
        this.normalMatrix = mat3.normalFromMat4(mat3.create(), this.worldMatrix);


        this.skin = config.nodeReference.getSkin() ?? undefined;

        this.parent = config.parent;
        this.mesh = config.mesh;
        config.primitivesData?.forEach((geo) => {
            this.primitivesData.set(geo.id, geo);
        });
    }

    setLodSelectionThreshold(threshold: number): void {
        this.lodSelectionThreshold = threshold;
    }

    appendPrimitive(primitive: RenderAblePrim) {
        if (this.primitives) {
            this.primitives.set(makePrimitiveKey(primitive.id, primitive.side), primitive);
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

    setTranslation(pos: vec3, matrix: mat4) {
        mat4.fromRotationTranslationScale(matrix, this.getRotation(matrix), pos, this.getScale(matrix));
        this.markTransformDirty()

    }

    setRotation(rot: quat, matrix: mat4) {
        mat4.fromRotationTranslationScale(matrix, rot, this.getTranslation(matrix), this.getScale(matrix));
        this.markTransformDirty()
    }

    setScale(scale: vec3, matrix: mat4) {
        mat4.fromRotationTranslationScale(matrix, this.getRotation(matrix), this.getTranslation(matrix), scale);
        this.markTransformDirty()
    }

    private getTranslation(matrix: mat4): vec3 {
        const pos = vec3.create();
        mat4.getTranslation(pos, matrix);
        return pos;
    }

    private getRotation(matrix: mat4): quat {
        const rot = quat.create();
        mat4.getRotation(rot, matrix);
        return rot;
    }

    private getScale(matrix: mat4): vec3 {
        const scale = vec3.create();
        mat4.getScaling(scale, matrix);
        return scale;
    }


    markTransformDirty() {
        this.needsUpdate = true;
        BaseLayer._updateQueue.set(this.id, this)
        for (const child of this.children) {
            child.markTransformDirty();
        }
    }

    updateWorldMatrix(device: GPUDevice | undefined = undefined) {
        const parentMatrix = this.parent?.worldMatrix;
        if (!this.needsUpdate && parentMatrix) return;

        mat4.multiply(this.localMatrix, this.animationMatrix, this.transformMatrix);
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
