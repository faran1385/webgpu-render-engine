import {Animation, GLTF, Skin, TypedArray} from "@gltf-transform/core";
import {mat4, quat, vec3} from "gl-matrix";
import {updateBuffer} from "../../helpers/global.helper.ts";

export class ModelAnimator {
    private findIndex(t: number, times: TypedArray) {
        for (let i = 0; i < times.length - 1; i++) {
            if (t >= times[i] && t < times[i + 1]) return i;
        }
        return -1
    }

    private interpolateValue(
        path: GLTF.AnimationChannelTargetPath,
        output: TypedArray,
        idx: number,
        alpha: number
    ): vec3 | quat {
        if (path === 'rotation') {
            const q0 = quat.fromValues(
                output[idx * 4 + 0], output[idx * 4 + 1],
                output[idx * 4 + 2], output[idx * 4 + 3]
            );
            const q1 = quat.fromValues(
                output[(idx + 1) * 4 + 0], output[(idx + 1) * 4 + 1],
                output[(idx + 1) * 4 + 2], output[(idx + 1) * 4 + 3]
            );
            return quat.slerp(quat.create(), q0, q1, alpha);
        } else {
            const size = 3;
            const v0 = vec3.fromValues(
                output[idx * size + 0],
                output[idx * size + 1],
                output[idx * size + 2]
            );
            const v1 = vec3.fromValues(
                output[(idx + 1) * size + 0],
                output[(idx + 1) * size + 1],
                output[(idx + 1) * size + 2]
            );
            return vec3.lerp(vec3.create(), v0, v1, alpha);
        }
    }

    private pingPong(time: number, length: number): number {
        const doubleLength = length * 2;
        const modTime = time % doubleLength;
        return length - Math.abs(modTime - length);
    }


    public update(device: GPUDevice, animation: Animation, time: number, skin: Skin, buffer: GPUBuffer, mode: "loop" | "backAndForth" | undefined = undefined) {
        const channels = animation.listChannels()
        const times = animation.listChannels()[0].getSampler()?.getInput()?.getArray();
        if (!times) throw new Error("we dont have times")
        const duration = times[times?.length - 1]
        let t = time;
        if (mode === "loop") {
            t = time % duration;
        } else if (mode === "backAndForth") {
            t = this.pingPong(time, duration);
        }
        for (const channel of channels) {
            const targetNode = channel.getTargetNode();
            const path = channel.getTargetPath()
            const inputs = channel.getSampler()?.getInput()?.getArray()
            const output = channel.getSampler()?.getOutput()?.getArray()
            if (!targetNode || !path || !inputs || !output) throw new Error("data required is missing")
            const correspondingIndex = this.findIndex(t, inputs)
            if (correspondingIndex === -1) continue;
            const t0 = inputs[correspondingIndex];
            const t1 = inputs[correspondingIndex + 1];
            const alpha = (t - t0) / (t1 - t0);
            const value = this.interpolateValue(path, output, correspondingIndex, alpha);
            if (path === 'translation') targetNode.setTranslation(value as any);
            else if (path === 'rotation') targetNode.setRotation(value as any);
            else if (path === 'scale') targetNode.setScale(value as any);
        }
        const calculatedBones = this.calculateBones(skin);
        if (calculatedBones) {
            updateBuffer(device, buffer, new Float32Array(calculatedBones))
        }
    }

    private calculateBones(skin: Skin) {
        const boneList = skin.listJoints();
        const invBindMatrices = skin.getInverseBindMatrices()?.getArray();
        if (!invBindMatrices) return undefined;

        const bonesArray: number[] = [];

        for (let i = 0; i < boneList.length; i++) {
            const jointNode = boneList[i];
            const jointWorld = jointNode.getWorldMatrix();
            const invBind = invBindMatrices.slice(i * 16, i * 16 + 16);

            const jointMat = mat4.create();
            mat4.multiply(jointMat, jointWorld, invBind as any);

            bonesArray.push(...jointMat);
        }
        return bonesArray
    }
}