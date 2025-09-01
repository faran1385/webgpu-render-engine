import xxhash, {XXHashAPI} from 'xxhash-wasm';
import {RenderState} from "../GPUCache/GPUCacheTypes.ts";
import {MaterialInstance} from "../../Material/Material.ts";
import {StandardMaterial, standardMaterialTextureInfo} from "../../Material/StandardMaterial.ts";

type Dim = [number, number];


type MatInfo = {
    material: StandardMaterial,
    textureKey: keyof standardMaterialTextureInfo,
    hash: number,
    dimensions: Dim
}

interface SetTextureResult {
    assignedShare?: { arrayIndex: number; dimensionKey: string };
    addedToHashRequests: boolean;
}

const MAX_SHARED_PER_ARRAY = 50;


export class HashGenerator {
    private static hasher: XXHashAPI;
    private static textEncoder: TextEncoder;
    private textureId = 0;
    textureHashCache = new WeakMap<Uint8Array, number>();
    textureHashToData = new Map<number, Uint8Array>();
    hashToRequests = new Map<number, Map<MaterialInstance, Set<(keyof standardMaterialTextureInfo)>>>();
    sharedTextureHashes = new Map<string, Set<number>[]>()
    private shaderHashCache = new Map<string, number>();
    private bindGroupLayoutHashCache = new Map<string, number>();
    private pipelineLayoutHashCache = new Map<string, number>();
    private pipelineHashCache = new Map<string, number>();

    // user loaded
    userLoadedTextureHashCache = new WeakMap<Uint8ClampedArray, number>();
    userLoadedTextureHashToData = new Map<number, Uint8ClampedArray>();

    public async init() {
        HashGenerator.hasher = await xxhash();

        HashGenerator.textEncoder = new TextEncoder();
    }

    userLoadedHashTexture(data: Uint8ClampedArray) {
        if (!this.userLoadedTextureHashCache.has(data)) {
            this.textureId++
            this.userLoadedTextureHashCache.set(data, this.textureId)
            this.userLoadedTextureHashToData.set(this.textureId, data)
            return this.textureId
        }

        return this.userLoadedTextureHashCache.get(data)!;
    }

    hashTexture(data: Uint8Array) {
        if (!this.textureHashCache.has(data)) {
            this.textureId++
            this.textureHashCache.set(data, this.textureId)
            this.textureHashToData.set(this.textureId, data)
            return this.textureId
        }

        return this.textureHashCache.get(data)!;
    }

    setTextureHashGraph(matInfo: MatInfo): SetTextureResult {
        if (!matInfo || typeof matInfo.hash !== "number" || !matInfo.dimensions) {
            return { addedToHashRequests: false };
        }

        const { hash, dimensions, material, textureKey } = matInfo;
        const dimensionKey = `${dimensions[0]}_${dimensions[1]}`;

        material.textureInfo[textureKey].hash = hash;
        material.textureInfo[textureKey].dimension = dimensions;

        let requestMap = this.hashToRequests.get(hash);
        if (!requestMap) {
            requestMap = new Map<MaterialInstance, Set<keyof standardMaterialTextureInfo>>();
            requestMap.set(material, new Set([textureKey]));
            this.hashToRequests.set(hash, requestMap);
            return { addedToHashRequests: true };
        }

        if (!requestMap.has(material)) {
            requestMap.set(material, new Set([textureKey]));
        } else {
            requestMap.get(material)!.add(textureKey);
        }

        if (requestMap.size <= 1) {
            return { addedToHashRequests: true };
        }

        let categoryArray = this.sharedTextureHashes.get(dimensionKey);
        if (!categoryArray) {
            categoryArray = [];
            this.sharedTextureHashes.set(dimensionKey, categoryArray);
        }

        const assignShareIndexToRequestMap = (arrayIndex: number) => {
            requestMap!.forEach((_, mat) => {
                mat.textureInfo[textureKey].shareInfo = {
                    arrayIndex,
                    dimension: dimensionKey
                };
            });
        };

        if (categoryArray.length === 0) {
            categoryArray.push(new Set<number>([hash]));
            assignShareIndexToRequestMap(0);
            return {
                addedToHashRequests: true,
                assignedShare: { arrayIndex: 0, dimensionKey }
            };
        }

        const lastIndex = categoryArray.length - 1;
        const lastBucket = categoryArray[lastIndex];

        if (lastBucket.size < MAX_SHARED_PER_ARRAY) {
            lastBucket.add(hash);
            assignShareIndexToRequestMap(lastIndex);
            return {
                addedToHashRequests: true,
                assignedShare: { arrayIndex: lastIndex, dimensionKey }
            };
        }

        const newIndex = categoryArray.length;
        categoryArray.push(new Set<number>([hash]));
        assignShareIndexToRequestMap(newIndex);
        return {
            addedToHashRequests: true,
            assignedShare: { arrayIndex: newIndex, dimensionKey }
        };
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

    public hashBindGroupLayout(entries: GPUBindGroupLayoutEntry[]): number {
        let str = '';
        for (const entry of entries) {
            str += entry.binding;
            str += entry.visibility;
            if (entry.buffer) {
                str += entry.buffer.type === "uniform" ? 0 : entry.buffer.type === "storage" ? 1 : 2;
            } else if (entry.texture) {
                str += entry.texture.sampleType
            } else if (entry.sampler) {
                str += entry.sampler.type
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

        const vConst = state.vertexConstants;
        if (vConst && Object.keys(vConst).length > 0) {
            const keys = Object.keys(vConst).sort();
            for (const key of keys) {
                str += key.length;
                str += key;
                str += vConst[key];
            }
        } else {
            str += "0";
        }

        const fConst = state.fragmentConstants;
        if (fConst && Object.keys(fConst).length > 0) {
            const keys = Object.keys(fConst).sort();
            for (const key of keys) {
                str += key.length;
                str += key;
                str += fConst[key];
            }
        } else {
            str += "0";
        }

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
