import {TypedArray, vec2} from "@gltf-transform/core";
import {vec3} from "gl-matrix";
import {MaterialInstance} from "../../Material/Material.ts"
import {RenderFlag} from "../MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";

export type bufferConvertFunc = (device: GPUDevice, data: TypedArray, usage: GPUBufferUsageFlags, label: string) => GPUBuffer
export type textureConvertFunc = (device: GPUDevice, size: vec2 | vec3, data: TypedArray, format: GPUTextureFormat) => Promise<GPUTexture>
export type BaseBindGroupEntryCreationType = {
    textureDescriptor?: {
        texture: GPUTexture,
        viewDescriptor: GPUTextureViewDescriptor
    },
    buffer?: GPUBuffer,
    sampler?: number,
    bindingPoint: number,
    materialResourcesKey?: string
}


export type BindGroupEntryCreationType = BaseBindGroupEntryCreationType & {
    typedArray?: {
        conversion: bufferConvertFunc | textureConvertFunc,
        data: TypedArray,
    } & ({
        conversionType: "texture",
        size: vec2 | vec3
        format: GPUTextureFormat,
        renderFlag: RenderFlag
    } | {
        conversionType: "buffer",
        label: string,
        usage: GPUBufferUsageFlags,
    })
}

export type CreateBindGroupEntry = {
    layoutList: Map<number, {
        layout: GPUBindGroupLayout,
        primitives: Set<number>
    }>,
    layoutHash: number,
    bindGroupHash: number
    material: MaterialInstance,
}
export type RenderState = {
    primitive: GPUPrimitiveState,
    targets: GPUColorTargetState[]
    depthStencil: GPUDepthStencilState
    vertexConstants?: Record<string, number>
    fragmentConstants?: Record<string, number>
}