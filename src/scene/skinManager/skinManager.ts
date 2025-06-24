import {BaseLayer} from "../../layers/baseLayer.ts";
import {SceneObject} from "../sceneObject/sceneObject.ts";
import {Node, Skin} from "@gltf-transform/core";
import {mat4, vec3} from "gl-matrix";
import {createGPUBuffer, updateBuffer} from "../../helpers/global.helper.ts";

export class SkinManager extends BaseLayer {
    private static skins = new Map<Skin, { data: number[], buffer: GPUBuffer, nodeMap: Map<Node, SceneObject> }>();

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);
        SkinManager.renderLoopRunAble.set("SkinUpdate", this.updateSkins)
    }

    getSkin(skin: Skin) {
        return SkinManager.skins.get(skin);
    }

    addSkin(skin: Skin, nodeMap: Map<Node, SceneObject>) {
        const data = SkinManager.calculateBones(skin, nodeMap)
        const buffer = createGPUBuffer(SkinManager.device, new Float32Array(data), GPUBufferUsage.STORAGE, "skin buffer")
        SkinManager.skins.set(skin, {nodeMap, buffer, data});

        return {nodeMap, buffer, data}
    }

    private static calculateBones(skin: Skin, nodeMap: Map<Node, SceneObject>) {
        const boneList = skin.listJoints();
        const invBindMatrices = skin.getInverseBindMatrices()?.getArray();
        if (!invBindMatrices) throw new Error("bone calculation needs inverseBindMatrices");

        const bonesArray: number[] = [];

        for (let i = 0; i < boneList.length; i++) {
            const jointNode = boneList[i];

            const jointSceneObj = nodeMap.get(jointNode);
            if (!jointSceneObj) {
                throw new Error("Joint node not found in scene object map.");
            }

            const jointWorld = jointSceneObj.worldMatrix;
            const invBind = invBindMatrices.slice(i * 16, i * 16 + 16);
            const s = vec3.create();
            mat4.getScaling(s, jointWorld);

            const jointMat = mat4.create();
            mat4.multiply(jointMat, jointWorld, invBind as any);

            bonesArray.push(...jointMat);
        }

        return bonesArray;
    }

    updateSkins() {
        SkinManager.skins.forEach((entry, skin) => {
            entry.data = SkinManager.calculateBones(skin, entry.nodeMap);
            updateBuffer(SkinManager.device, entry.buffer, new Float32Array(entry.data))
        });
    }

}