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
export class LightManager {
    private static device: GPUDevice;

    private maxDirectional: number;
    private maxPoint: number;
    private nextId = 1;
    public lightsBuffer: LightBuffers;
    private needUpdate = false;
    private dLights = new Map<number, DLight>();
    private pLights = new Map<number, PLight>();


    constructor(device: GPUDevice) {
        this.maxDirectional = 0;
        LightManager.device = device;
        this.maxPoint = 0;

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
     * Removes a directional light by its ID.
     */
    removeDirectional(id: number): void {
        if (this.dLights.delete(id)) {
            this.needUpdate = true;
        }
    }

    /**
     * Adds a point light and returns its unique ID.
     */
    addPoint(light: PLight): number {
        const id = this.nextId++;
        this.pLights.set(id, light);
        this.needUpdate = true;
        return id;
    }

    /**
     * Removes a point light by its ID.
     */
    removePoint(id: number): void {
        if (this.pLights.delete(id)) {
            this.needUpdate = true;
        }
    }

    /**
     * Ensures GPU buffers are correctly sized and up-to-date.
     * Call once per frame before rendering.
     */
    flushIfDirty() {
        if(!this.needUpdate) return
        const neededD = this.dLights.size;
        const neededP = this.pLights.size;
        let needToReBind = false


        if (neededD > this.maxDirectional) {
            this.resizeDirectionalBuffer(neededD);
            needToReBind = true;
        }
        if (neededP > this.maxPoint) {
            this.resizePointBuffer(neededP);
            needToReBind = true;
        }
        this.uploadCounts();
        this.uploadDLights();
        this.uploadPLights();
        this.needUpdate = false;
        return needToReBind
    }

    private resizeDirectionalBuffer(newMax: number): void {
        if (this.lightsBuffer) {
            this.lightsBuffer.directional.destroy();
        }
        this.maxDirectional = newMax;
        const floatCount = newMax * 8;
        const byteSize = floatCount * 4;
        this.lightsBuffer.directional = LightManager.device.createBuffer({
            size: byteSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
    }

    private createMinimalBuffer(): GPUBuffer {
        return LightManager.device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
    }

    protected createLightEmptyBuffers(dirMax: number, ptMax: number): LightBuffers {

        const directional = dirMax > 0
            ? LightManager.device.createBuffer({
                size: dirMax * 8 * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            })
            : this.createMinimalBuffer();

        const point = ptMax > 0
            ? LightManager.device.createBuffer({
                size: ptMax * 8 * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            })
            : this.createMinimalBuffer();

        const counts = LightManager.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        return {directional, point, counts};
    }

    private resizePointBuffer(newMax: number): void {
        if (this.lightsBuffer) {
            this.lightsBuffer.point.destroy();
        }
        this.maxPoint = newMax;
        const floatCount = newMax * 8;
        const byteSize = floatCount * 4;
        this.lightsBuffer.point = LightManager.device.createBuffer({
            size: byteSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
    }

    private uploadCounts(): void {
        if (!this.lightsBuffer) return;
        const counts = new Uint32Array([
            this.dLights.size,
            this.pLights.size,
            0,
            0,
        ]);
        LightManager.device.queue.writeBuffer(this.lightsBuffer.counts, 0, counts.buffer);
    }

    private uploadDLights(): void {
        if (!this.lightsBuffer) return;
        const data = new Float32Array(this.maxDirectional * 8);
        let offset = 0;

        for (const light of this.dLights.values()) {
            data.set(light.color, offset);    // vec3
            offset += 3;

            data[offset++] = light.intensity; // f32

            data.set(light.position, offset); // vec3
            offset += 3;

            data[offset++] = 0.0;             // padding (f32)
        }


        updateBuffer(LightManager.device, this.lightsBuffer.directional, data)
    }

    private uploadPLights(): void {
        if (!this.lightsBuffer) return;
        const data = new Float32Array(this.maxPoint * 8);
        let offset = 0;
        for (const light of this.pLights.values()) {
            data.set(light.color, offset);
            offset += 3;
            data[offset++] = light.intensity;
            data.set(light.position, offset);
            offset += 3;
            data[offset++] = light.decay;
        }
        updateBuffer(LightManager.device, this.lightsBuffer.point, data)
    }
}
