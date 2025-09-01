import {TextureInfo} from "@gltf-transform/core";
import {BaseLayer} from "../../layers/baseLayer.ts";

interface GLTFSamplerProps {
    magFilter?: 9728 | 9729;
    minFilter?:
        | 9728
        | 9729
        | 9984
        | 9985
        | 9986
        | 9987;
    wrapS?: 33071 | 33648 | 10497;
    wrapT?: 33071 | 33648 | 10497;
    /** Optional anisotropy extension value (e.g. KHR_texture_transform) */
    maxAnisotropy?: number;
}

export class TextureGenerator {
    private textureCache = new WeakMap<Uint8Array, GPUTexture>();
    private samplerCache = new Map<string, {
        sampler: GPUSampler,
        name: `SAMPLER_${number}`
    }>()
    private nameToSampler=new Map<string, GPUSampler>()
    private samplerCounter = 0;

    public getSampler(key: string) {
        return this.nameToSampler.get(key);
    }

    mapMagFilter(filter?: number): GPUFilterMode {
        switch (filter) {
            case 9728:
                return 'nearest';
            case 9729:
                return 'linear';
            default:
                return 'linear';
        }
    }

    mapMinFilter(filter?: number): {
        minFilter: GPUFilterMode;
        mipmapFilter: GPUFilterMode;
    } {
        switch (filter) {
            case 9728: // NEAREST
                return {minFilter: 'nearest', mipmapFilter: 'nearest'};
            case 9729: // LINEAR
                return {minFilter: 'linear', mipmapFilter: 'nearest'};
            case 9984: // NEAREST_MIPMAP_NEAREST
                return {minFilter: 'nearest', mipmapFilter: 'nearest'};
            case 9985: // LINEAR_MIPMAP_NEAREST
                return {minFilter: 'linear', mipmapFilter: 'nearest'};
            case 9986: // NEAREST_MIPMAP_LINEAR
                return {minFilter: 'nearest', mipmapFilter: 'linear'};
            case 9987: // LINEAR_MIPMAP_LINEAR
                return {minFilter: 'linear', mipmapFilter: 'linear'};
            default:
                // default glTF: LINEAR_MIPMAP_LINEAR
                return {minFilter: 'linear', mipmapFilter: 'linear'};
        }
    }

    mapWrap(mode?: number): GPUAddressMode {
        switch (mode) {
            case 33071:
                return 'clamp-to-edge';
            case 33648:
                return 'mirror-repeat';
            case 10497:
                return 'repeat';
            default:
                return 'repeat';
        }
    }

    samplerKey(desc: GPUSamplerDescriptor): string {
        return [
            desc.minFilter, desc.magFilter, desc.mipmapFilter,
            desc.addressModeU, desc.addressModeV, desc.addressModeW,
            desc.maxAnisotropy ?? ''
        ].join('|');
    }


    createSampler(
        sampler: GLTFSamplerProps
    ) {
        const {minFilter, magFilter, wrapS, wrapT, maxAnisotropy} = sampler;
        const mag = this.mapMagFilter(magFilter);
        const {minFilter: minF, mipmapFilter} = this.mapMinFilter(minFilter);
        const addressModeU = this.mapWrap(wrapS);
        const addressModeV = this.mapWrap(wrapT);
        const descriptor: GPUSamplerDescriptor = {
            magFilter: mag,
            minFilter: minF,
            mipmapFilter,
            addressModeU,
            addressModeV,
            addressModeW: 'repeat',
        };
        if (maxAnisotropy !== undefined) descriptor.maxAnisotropy = maxAnisotropy;


        let key = this.samplerKey(descriptor)
        if (this.samplerCache.has(key)) {
            return this.samplerCache.get(key)!
        }
        this.samplerCounter++;
        const gpuSampler = BaseLayer.device.createSampler(descriptor)
        this.samplerCache.set(key, {
            sampler: gpuSampler,
            name: `SAMPLER_${this.samplerCounter}`,
        })
        this.nameToSampler.set(`SAMPLER_${this.samplerCounter}`,gpuSampler)

        return {
            sampler: gpuSampler,
            name: `SAMPLER_${this.samplerCounter}`,
        };
    }

    createSamplerCaller(info: TextureInfo | null) {
        return this.createSampler({
            magFilter: info?.getMagFilter() ?? undefined,
            minFilter: info?.getMinFilter() ?? undefined,
            wrapS: info?.getWrapS(),
            wrapT: info?.getWrapT(),
        })
    }

    async decodeToRGBA(data: Uint8Array) {
        const bitmap = await createImageBitmap(new Blob([data]));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        return imageData.data;
    }

    public async getGPUTexture(data: Uint8Array, size: { width: number, height: number }, format: GPUTextureFormat) {
        const cached = this.textureCache.get(data);
        if (cached) return cached;
        const gpuTex = BaseLayer.device.createTexture({
            size: [size.width, size.height, 1],
            format: format,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        const convertedData = await this.decodeToRGBA(data);
        this.copyDataIntoTextureLayers(gpuTex, size, convertedData, {x: 0, y: 0, z: 0})
        this.textureCache.set(data, gpuTex);
        return gpuTex;
    }

    copyDataIntoTextureLayers(texture: GPUTexture, size: {
        width: number,
        height: number
    }, data: Uint8ClampedArray, origin: {
        x: number,
        y: number,
        z: number
    }) {
        BaseLayer.device.queue.writeTexture(
            {
                texture,
                origin
            },
            data,
            {
                bytesPerRow: size.width * 4,
                rowsPerImage: size.height
            },
            {
                width: size.width,
                height: size.height,
                depthOrArrayLayers: 1
            }
        );
    }
}