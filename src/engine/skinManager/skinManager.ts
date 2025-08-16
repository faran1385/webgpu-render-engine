import {SceneObject} from "../sceneObject/sceneObject.ts";
import {Node, Skin} from "@gltf-transform/core";
import {mat4} from "gl-matrix";
import {createGPUBuffer, updateBuffer} from "../../helpers/global.helper.ts";
import {BaseLayer} from "../../layers/baseLayer.ts";

export class SkinManager extends BaseLayer {
    private static skins = new Map<Skin, { data: Float32Array, buffer: GPUBuffer, nodeMap: Map<Node, SceneObject> }>();

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);
    }

    getSkin(skin: Skin) {
        return SkinManager.skins.get(skin);
    }

    addSkin(skin: Skin, nodeMap: Map<Node, SceneObject>) {
        const data = SkinManager.calculateBones(skin, nodeMap)
        const buffer = createGPUBuffer(SkinManager.device, data, GPUBufferUsage.STORAGE, "skin buffer")
        SkinManager.skins.set(skin, {nodeMap, buffer, data});

        return {nodeMap, buffer, data}
    }

    private static calculateBones(skin: Skin, nodeMap: Map<Node, SceneObject>) {
        const invBindAccessor = skin.getInverseBindMatrices();
        if (!invBindAccessor) throw new Error('Skin has no inverseBindMatrices accessor.');
        const invBindArray = invBindAccessor.getArray() as Float32Array;
        const joints = skin.listJoints();
        const jointCount = joints.length;

        if (invBindArray.length < jointCount * 16) {
            throw new Error('inverseBindMatrices length is smaller than jointCount * 16.');
        }

        // 2) find a mesh SceneObject that uses this skin (preferable)
        //    We expect your SceneObject to have `skin?: Skin` set when it was created.
        let meshSceneObj: SceneObject | undefined;
        for (const so of nodeMap.values()) {
            if (so.skin === skin) { meshSceneObj = so; break; }
        }

        // 3) fallback: if no SceneObject explicitly references skin, try skin.getSkeleton() node -> SceneObject
        if (!meshSceneObj) {
            const skeletonNode = skin.getSkeleton?.();
            if (skeletonNode) meshSceneObj = nodeMap.get(skeletonNode);
        }

        // 4) compute inverse(meshModelWorld) — if we have no meshSceneObj, use identity (assume joints already model-space)
        const meshModelWorldInv = mat4.create();
        if (meshSceneObj) {
            if (!mat4.invert(meshModelWorldInv, meshSceneObj.worldMatrix)) {
                throw new Error('mesh model/world matrix is non-invertible.');
            }
        } else {
            mat4.identity(meshModelWorldInv); // assume jointWorld == jointModel if no mesh node found
        }
        // 5) prepare output Float32Array
        const out = new Float32Array(jointCount * 16);

        for (let i = 0; i < jointCount; i++) {
            const jointNode = joints[i];
            const jointSceneObj = nodeMap.get(jointNode);
            if (!jointSceneObj) {
                throw new Error(`Joint node at index ${i} not found in nodeMap.`);
            }

            const jointWorld = jointSceneObj.worldMatrix; // mat4

            // jointModel = inv(meshModelWorld) * jointWorld
            const jointModel = mat4.create();
            mat4.multiply(jointModel, meshModelWorldInv, jointWorld);

            // invBind slice -> mat4
            const sliceStart = i * 16;
            const invBindSlice = invBindArray.subarray(sliceStart, sliceStart + 16);
            const invBindMat = mat4.clone(invBindSlice as unknown as mat4);

            // boneMatrix = jointModel * invBind
            const boneMat = mat4.create();
            mat4.multiply(boneMat, jointModel, invBindMat);

            // write into output (column-major)
            out.set(boneMat as unknown as Float32Array, i * 16);
        }

        return out;
    }

    updateSkins() {
        SkinManager.skins.forEach((entry, skin) => {
            entry.data = SkinManager.calculateBones(skin, entry.nodeMap);
            updateBuffer(SkinManager.device, entry.buffer, new Float32Array(entry.data))
        });
    }

}