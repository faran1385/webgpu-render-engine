import {TypedArray,} from "@gltf-transform/core";
import {standardMaterialTextureInfo} from "../../Material/StandardMaterial.ts";

export type BaseBindGroupEntryCreationType = {
    buffer?: GPUBuffer,
    sampler?: GPUSampler,
    bindingPoint: number,
    textureDescriptor?: {
        texture: GPUTexture,
        viewDescriptor: GPUTextureViewDescriptor
    },
    additional?: {
        textureArray?: {
            textureMap: Map<number, (keyof standardMaterialTextureInfo)[]>
            size: [number, number],
        },
        resourcesKey?: string
        typedArray?: (TextureTypedArray | BufferTypedArray),
        samplerDescriptor?: GPUSamplerDescriptor
    }
}


export type TextureTypedArray = {
    format: GPUTextureFormat,
    size: { width: number; height: number; },
    data: Uint8Array
    convertType: "texture"
}
export type BufferTypedArray = {
    data: TypedArray,
    label: string,
    usage: GPUBufferUsageFlags,
    convertType: "buffer"
}

export type RenderState = {
    primitive: GPUPrimitiveState,
    targets: GPUColorTargetState[]
    depthStencil: GPUDepthStencilState
    vertexConstants?: Record<string, number>
    fragmentConstants?: Record<string, number>
}