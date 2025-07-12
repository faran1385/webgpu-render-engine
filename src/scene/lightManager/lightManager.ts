import {BaseLayer} from "../../layers/baseLayer.ts";
import {updateBuffer} from "../../helpers/global.helper.ts";

export interface DLight {
    color: [number, number, number];
    intensity: number;
    position: [number, number, number];
}

export interface PLight extends DLight {
    decay: number;
}

export interface LightBuffers {
    directional: GPUBuffer;
    point: GPUBuffer;
    counts: GPUBuffer;
}

/**
 * Manages directional and point lights with dynamic GPU buffers.
 * Provides add/remove by ID for fast lookup.
 * Buffers are created/expanded on-demand via flushIfDirty().
 */
export class LightManager extends BaseLayer {
    private static maxDirectional: number;
    private static maxPoint: number;
    private static nextId = 1;

    private static dLights = new Map<number, DLight>();
    private static pLights = new Map<number, PLight>();


    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx)
        LightManager.maxDirectional = 0;
        LightManager.maxPoint = 0;
    }

    /**
     * Adds a directional light and returns its unique ID.
     */
    addDirectional(light: DLight): number {
        const id = LightManager.nextId++;
        LightManager.dLights.set(id, light);
        LightManager.renderLoopRunAble.set("LightUpdate", this.flushIfDirty)
        return id;
    }

    /**
     * Removes a directional light by its ID.
     */
    removeDirectional(id: number): void {
        if (LightManager.dLights.delete(id)) {
            LightManager.renderLoopRunAble.set("LightUpdate", this.flushIfDirty)
        }
    }

    /**
     * Adds a point light and returns its unique ID.
     */
    addPoint(light: PLight): number {
        const id = LightManager.nextId++;
        LightManager.pLights.set(id, light);
        LightManager.renderLoopRunAble.set("LightUpdate", this.flushIfDirty)
        return id;
    }

    /**
     * Removes a point light by its ID.
     */
    removePoint(id: number): void {
        if (LightManager.pLights.delete(id)) {
            LightManager.renderLoopRunAble.set("LightUpdate", this.flushIfDirty)
        }
    }

    /**
     * Ensures GPU buffers are correctly sized and up-to-date.
     * Call once per frame before rendering.
     */
    flushIfDirty(): void {

        const neededD = LightManager.dLights.size;
        const neededP = LightManager.pLights.size;
        let needToReBind = false


        if (neededD > LightManager.maxDirectional) {
            LightManager.resizeDirectionalBuffer(neededD);
            needToReBind = true;
        }
        if (neededP > LightManager.maxPoint) {
            LightManager.resizePointBuffer(neededP);
            needToReBind = true;
        }
        if (needToReBind) LightManager.setGlobalBindGroup()
        LightManager.uploadCounts();
        LightManager.uploadDLights();
        LightManager.uploadPLights();

        LightManager.renderLoopRunAble.delete("LightUpdate")
    }

    private static resizeDirectionalBuffer(newMax: number): void {
        if (LightManager.lightsBuffer) {
            LightManager.lightsBuffer.directional.destroy();
        }
        LightManager.maxDirectional = newMax;
        const floatCount = newMax * 8;
        const byteSize = floatCount * 4;
        LightManager.lightsBuffer.directional = LightManager.device.createBuffer({
            size: byteSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
    }

    private static resizePointBuffer(newMax: number): void {
        if (LightManager.lightsBuffer) {
            LightManager.lightsBuffer.point.destroy();
        }
        LightManager.maxPoint = newMax;
        const floatCount = newMax * 8;
        const byteSize = floatCount * 4;
        LightManager.lightsBuffer.point = LightManager.device.createBuffer({
            size: byteSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
    }

    private static uploadCounts(): void {
        if (!LightManager.lightsBuffer) return;
        const counts = new Uint32Array([
            LightManager.dLights.size,
            LightManager.pLights.size,
            0,
            0,
        ]);
        LightManager.device.queue.writeBuffer(LightManager.lightsBuffer.counts, 0, counts.buffer);
    }

    private static uploadDLights(): void {
        if (!LightManager.lightsBuffer) return;
        const data = new Float32Array(LightManager.maxDirectional * 8);
        let offset = 0;

        for (const light of LightManager.dLights.values()) {
            data.set(light.color, offset);    // vec3
            offset += 3;

            data[offset++] = light.intensity; // f32

            data.set(light.position, offset); // vec3
            offset += 3;

            data[offset++] = 0.0;             // padding (f32)
        }


        updateBuffer(LightManager.device, LightManager.lightsBuffer.directional, data)
    }

    private static uploadPLights(): void {
        if (!LightManager.lightsBuffer) return;
        const data = new Float32Array(LightManager.maxPoint * 8);
        let offset = 0;
        for (const light of LightManager.pLights.values()) {
            data.set(light.color, offset);
            offset += 3;
            data[offset++] = light.intensity;
            data.set(light.position, offset);
            offset += 3;
            data[offset++] = light.decay;
        }
        updateBuffer(LightManager.device, LightManager.lightsBuffer.point, data)
    }
}
