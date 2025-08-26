import {updateBuffer} from "../../helpers/global.helper.ts";

export interface DLight {
    color: [number, number, number];
    intensity: number;
    position: [number, number, number];
}

export interface ALight {
    color: [number, number, number];
    intensity: number;
}

export interface LightBuffers {
    directional: GPUBuffer;
    ambient: GPUBuffer;
    counts: GPUBuffer;
}

/**
 * Manages directional lights with dynamic GPU buffers.
 * Provides add/remove by ID for fast lookup.
 * Buffers are created/expanded on-demand via flushIfDirty().
 */
export class LightManager {
    private static device: GPUDevice;

    private maxDirectional: number;
    private maxAmbient: number;
    private nextId = 1;
    public lightsBuffer: LightBuffers;
    private needUpdate = false;
    private dLights = new Map<number, DLight>();
    private aLights = new Map<number, ALight>();


    constructor(device: GPUDevice) {
        this.maxDirectional = 0;
        this.maxAmbient = 0;
        LightManager.device = device;

        this.lightsBuffer = this.createLightEmptyBuffers(0, 0)
    }

    /**
     * Adds a directional light and returns its unique ID.
     */
    addDirectional(light: DLight): number {
        const id = this.nextId++;
        this.dLights.set(id, light);
        this.needUpdate = true;
        return id;
    }

    /**
     * Adds an ambient light and returns its unique ID.
     */
    addAmbient(light: ALight): number {
        const id = this.nextId++;
        this.aLights.set(id, light);
        this.needUpdate = true;
        return id;
    }

    /**
     * Removes an ambient light by its ID.
     */
    removeAmbient(id: number): void {
        if (this.aLights.delete(id)) {
            this.needUpdate = true;
        }
    }

    /**
     * Removes a directional light by its ID.
     */
    removeDirectional(id: number): void {
        if (this.dLights.delete(id)) {
            this.needUpdate = true;
        }
    }


    /**
     * Ensures GPU buffers are correctly sized and up-to-date.
     * Call once per frame before rendering.
     */
    flushIfDirty() {
        if (!this.needUpdate) return
        const neededD = this.dLights.size;
        const neededA = this.aLights.size;
        let needToReBind = false


        if (neededD > this.maxDirectional) {
            this.resizeDirectionalBuffer(neededD);
            needToReBind = true;
        }
        if (neededA > this.maxAmbient) {
            this.resizeAmbientBuffer(neededA);
            needToReBind = true;
        }
        this.uploadCounts();
        this.uploadDLights();
        this.uploadALights();
        this.needUpdate = false;
        return needToReBind
    }

    private resizeDirectionalBuffer(newMax: number): void {
        if (this.lightsBuffer) {
            this.lightsBuffer.directional.destroy();
        }
        this.maxDirectional = newMax;
        const floatCount = newMax * 12;
        const byteSize = floatCount * 4;
        this.lightsBuffer.directional = LightManager.device.createBuffer({
            size: byteSize,
            label:"directional light",
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
    }

    private createMinimalBuffer(size:number): GPUBuffer {
        return LightManager.device.createBuffer({
            size,
            label:"minimal buffer",
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
    }

    protected createLightEmptyBuffers(dirMax: number, aMax: number): LightBuffers {

        const directional = dirMax > 0
            ? LightManager.device.createBuffer({
                size: dirMax * 12 * 4,
                label:"directional light",
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            })
            : this.createMinimalBuffer(48);

        const ambient = aMax > 0
            ? LightManager.device.createBuffer({
                size: aMax * 8 * 4,
                label:"ambient light",
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            })
            : this.createMinimalBuffer(32);

        const counts = LightManager.device.createBuffer({
            size: 16,
            label:"light count buffer",
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        return {directional, ambient, counts};
    }

    private resizeAmbientBuffer(newMax: number): void {
        if (this.lightsBuffer) {
            this.lightsBuffer.ambient.destroy();
        }
        this.maxAmbient = newMax;
        const floatCount = newMax * 8;
        const byteSize = floatCount * 4;
        this.lightsBuffer.ambient = LightManager.device.createBuffer({
            size: byteSize,
            label:"ambient buffer",
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
    }


    private uploadCounts(): void {
        if (!this.lightsBuffer) return;
        const counts = new Uint32Array([
            this.dLights.size,
            this.aLights.size,
            0,
            0,
        ]);
        LightManager.device.queue.writeBuffer(this.lightsBuffer.counts, 0, counts.buffer);
    }

    private uploadDLights(): void {
        if (!this.lightsBuffer) return;
        const data = new Float32Array(this.maxDirectional * 12);
        let offset = 0;

        for (const light of this.dLights.values()) {
            data.set(light.color, offset);    // vec3
            offset += 3;
            data[offset++] = light.intensity; // f32

            data.set(light.position, offset); // vec3
            offset += 3;

            data[offset++] = 0; // f32

        }

        updateBuffer(LightManager.device, this.lightsBuffer.directional, data)
    }


    private uploadALights(): void {
        if (!this.lightsBuffer) return;
        const data = new Float32Array(this.maxAmbient * 8);
        let offset = 0;
        for (const light of this.aLights.values()) {
            data.set(light.color, offset);
            offset += 3;
            data[offset++] = light.intensity;
        }
        updateBuffer(LightManager.device, this.lightsBuffer.ambient, data)
    }
}
