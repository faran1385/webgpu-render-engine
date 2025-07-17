import xxhash, {XXHashAPI} from 'xxhash-wasm';
import {RenderState} from "../GPUCache/GPUCacheTypes.ts";
import {TypedArray} from "@gltf-transform/core";

export type HashCreationBindGroupEntry = TypedArray[];

export class HashGenerator {
    private static hasher: XXHashAPI;
    private static textEncoder: TextEncoder;

    private bindGroupEntriesHashCache = new WeakMap<TypedArray, number>();
    private bindGroupHashCache = new Map<string, number>();
    private shaderHashCache = new Map<string, number>();
    private bindGroupLayoutHashCache = new Map<string, number>();
    private samplerHashCache = new Map<string, number>();
    private pipelineLayoutHashCache = new Map<string, number>();
    private pipelineHashCache = new Map<string, number>();

    public async init() {
        HashGenerator.hasher = await xxhash();

        HashGenerator.textEncoder = new TextEncoder();
    }

    private encodeSampler(desc: GPUSamplerDescriptor): string {
        return [
            desc.addressModeU ?? "none",
            desc.addressModeV ?? "none",
            desc.addressModeW ?? "none",
            desc.magFilter ?? "none",
            desc.minFilter ?? "none",
            desc.mipmapFilter ?? "none",
            desc.lodMinClamp?.toFixed(4) ?? "0.0000",
            desc.lodMaxClamp?.toFixed(4) ?? "32.0000",
            desc.compare ?? "none",
            desc.maxAnisotropy ?? 1
        ].join("-");
    }


    public hashSampler(desc: GPUSamplerDescriptor) {
        const key = this.encodeSampler(desc);

        if (this.samplerHashCache.has(key)) {
            return this.samplerHashCache.get(key)!;
        }

        const hash = HashGenerator.hasher.h32(key);
        this.samplerHashCache.set(key, hash);
        return hash;
    }

    public hashShaderModule(shaderCode: string): number {
        if (this.shaderHashCache.has(shaderCode)) {
            return this.shaderHashCache.get(shaderCode)!;
        }

        const encoded = HashGenerator.textEncoder.encode(shaderCode);
        const hash = HashGenerator.hasher.h32Raw(encoded);
        this.shaderHashCache.set(shaderCode, hash);
        return hash;
    }

    public hashBindGroup(entries: HashCreationBindGroupEntry): number {
        const key = entries.map(entry => {
            const hash = Math.random()
            this.bindGroupEntriesHashCache.set(entry, hash)
            return hash
        }).join("|");
        if (this.bindGroupHashCache.has(key)) {
            return this.bindGroupHashCache.get(key)!;
        }
        const hash = HashGenerator.hasher.h32(key);
        this.bindGroupHashCache.set(key, hash);
        return hash;
    }

    public hashBindGroupLayout(entries: GPUBindGroupLayoutEntry[]): number {

        let str = '';
        for (const entry of entries) {
            str += entry.binding;
            str += entry.visibility;
            if (entry.buffer) {
                str += entry.buffer.type === "uniform" ? 0 : entry.buffer.type === "storage" ? 1 : 2;
            } else if (entry.texture) {
                str += ["float", "sint", "uint", "depth"].indexOf(entry.texture.sampleType ?? "float");
            } else if (entry.sampler) {
                str += ["filtering", "comparison"].indexOf(entry.sampler.type ?? "filtering");
            }
        }
        const hashInCache = this.bindGroupLayoutHashCache.get(str);
        if (hashInCache) {
            return hashInCache;
        }
        const hash = HashGenerator.hasher.h32(str);
        this.bindGroupLayoutHashCache.set(str, hash)
        return hash;
    }

    public hashPipelineLayout(materialLayoutHash: number, geometryLayoutHash: number): number {
        let str = `${materialLayoutHash} ${geometryLayoutHash}`;

        const hashInCache = this.pipelineLayoutHashCache.get(str);
        if (hashInCache) {
            return hashInCache;
        }

        const hash = HashGenerator.hasher.h32(`${materialLayoutHash} ${geometryLayoutHash}`);
        this.pipelineLayoutHashCache.set(str, hash)
        return hash;
    }

    public hashPipeline(state: RenderState, pipelineLayoutHash: number, buffers: GPUVertexBufferLayout[]): number {
        let str = this.hashRenderState(state, buffers) + pipelineLayoutHash;

        const hashInCache = this.pipelineHashCache.get(str);
        if (hashInCache) {
            return hashInCache;
        }

        const hash = HashGenerator.hasher.h32(str);
        this.pipelineHashCache.set(str, hash)
        return hash;
    }

    private hashRenderState(state: RenderState, buffers: GPUVertexBufferLayout[]): string {
        let str = "";

        const primitive = state.primitive ?? {} as GPUPrimitiveState;
        const topoMap: Record<GPUPrimitiveTopology, number> = {
            "point-list": 0,
            "line-list": 1,
            "line-strip": 2,
            "triangle-list": 3,
            "triangle-strip": 4
        };
        const frontFaceMap: Record<GPUFrontFace, number> = {"ccw": 0, "cw": 1};
        const cullModeMap: Record<GPUCullMode, number> = {"none": 0, "front": 1, "back": 2};

        str += topoMap[primitive.topology ?? "triangle-list"] ?? -1;
        str += primitive.stripIndexFormat ? 1 : 0;
        str += frontFaceMap[primitive.frontFace ?? "ccw"] ?? -1;
        str += primitive.cullMode ? (cullModeMap[primitive.cullMode] ?? -1) : -1;

        for (const buffer of buffers ?? []) {
            str += buffer.stepMode === "instance" ? 1 : 0;
            str += buffer.arrayStride;
            for (const attr of buffer.attributes ?? []) {
                str += attr.shaderLocation;
                str += attr.offset;
                str += attr.format?.length ?? -1;
            }
        }

        for (const target of state.targets ?? []) {
            str += target.format?.length ?? -1;

            if (target.blend) {
                const c = target.blend.color, a = target.blend.alpha;
                str += this.blendFactor(c?.srcFactor) + this.blendFactor(c?.dstFactor) + this.blendOp(c?.operation);
                str += this.blendFactor(a?.srcFactor) + this.blendFactor(a?.dstFactor) + this.blendOp(a?.operation);
            } else {
                str += "-1".repeat(6);
            }

            str += target.writeMask ?? 0xF;
        }

        const ds = state.depthStencil ?? {} as GPUDepthStencilState;
        str += ds.depthWriteEnabled ? 1 : 0;
        str += this.compareFunc(ds.depthCompare ?? "always");

        const sf = ds.stencilFront;
        str += sf ? (
            this.compareFunc(sf.compare) +
            this.stencilOp(sf.failOp) +
            this.stencilOp(sf.depthFailOp) +
            this.stencilOp(sf.passOp)
        ) : "-1".repeat(4);

        const sb = ds.stencilBack;
        str += sb ? (
            this.compareFunc(sb.compare) +
            this.stencilOp(sb.failOp) +
            this.stencilOp(sb.depthFailOp) +
            this.stencilOp(sb.passOp)
        ) : "-1".repeat(4);

        str += ds.stencilReadMask ?? 0xffffffff;
        str += ds.stencilWriteMask ?? 0xffffffff;
        str += ds.format?.length ?? -1;

        return str;
    }

    private compareFunc(func: GPUCompareFunction | undefined): number {
        return [
            "never", "less", "equal", "less-equal",
            "greater", "not-equal", "greater-equal", "always"
        ].indexOf(func ?? "always");
    }

    private stencilOp(op: GPUStencilOperation | undefined): number {
        return [
            "keep", "zero", "replace",
            "invert", "increment-clamp",
            "decrement-clamp", "increment-wrap", "decrement-wrap"
        ].indexOf(op ?? "keep");
    }

    private blendFactor(f: GPUBlendFactor | undefined): number {
        return [
            "zero", "one", "src", "one-minus-src",
            "src-alpha", "one-minus-src-alpha", "dst",
            "one-minus-dst", "dst-alpha", "one-minus-dst-alpha",
            "src-alpha-saturated", "constant", "one-minus-constant"
        ].indexOf(f ?? "zero");
    }

    private blendOp(op: GPUBlendOperation | undefined): number {
        return ["add", "subtract", "reverse-subtract", "min", "max"].indexOf(op ?? "add");
    }
}
