import {MaterialInstance} from "../../Material/Material.ts";
import {StandardMaterial, standardMaterialTextureInfo} from "../../Material/StandardMaterial.ts";
import {BaseLayer} from "../../../layers/baseLayer.ts";
import {GPUCache} from "../GPUCache/GPUCache.ts";
import {unpackPrimitiveKey} from "../../../helpers/global.helper.ts";
import {PrimitiveHashes} from "../../primitive/Primitive.ts";
import {SmartRender} from "../SmartRender/SmartRender.ts";

export class MaterialLayoutGenerator {

    setDescriptors(materials: MaterialInstance[]) {

        const sharedBuckets = new Map<string, Map<number, {
            layer: number,
            materials: Map<MaterialInstance, (keyof standardMaterialTextureInfo)[]>
        }>>();
        const personalBuckets = new Map<MaterialInstance, Map<string, Map<number, {
            layer: number,
            textureData: (keyof standardMaterialTextureInfo)[]
        }>>>();
        const samplerBuckets = new Map<string, Map<MaterialInstance, { sampler: GPUSampler, textures: string[] }>>();

        for (const material of materials) {
            const personalMap = new Map<string, Map<number, {
                layer: number,
                textureData: (keyof standardMaterialTextureInfo)[]
            }>>();
            personalBuckets.set(material, personalMap);

            for (const key in material.textureInfo) {
                const tex = material.textureInfo[key as keyof standardMaterialTextureInfo];

                if (!tex.hash || !tex.dimension) continue;

                if (!samplerBuckets.has(tex.samplerKey)) {
                    samplerBuckets.set(tex.samplerKey, new Map());
                }
                const matSamplers = samplerBuckets.get(tex.samplerKey)!;
                if (!matSamplers.has(material)) {
                    matSamplers.set(material, {
                        sampler: GPUCache.textureGenerator.getSampler(tex.samplerKey)!,
                        textures: []
                    });
                }
                matSamplers.get(material)!.textures.push(key);

                if (tex.shareInfo) {
                    const sharedKey = `SHARE${tex.shareInfo.arrayIndex}@${tex.dimension[0]}_${tex.dimension[1]}`;
                    if (!sharedBuckets.has(sharedKey)) sharedBuckets.set(sharedKey, new Map());
                    const hashMap = sharedBuckets.get(sharedKey)!;
                    const layer = hashMap.size;
                    if (!hashMap.has(tex.hash)) hashMap.set(tex.hash, {
                        materials: new Map(),
                        layer
                    });
                    const matMap = hashMap.get(tex.hash)!.materials;

                    if (!matMap.has(material)) matMap.set(material, []);
                    matMap.get(material)!.push(key as keyof standardMaterialTextureInfo);
                } else if (key !== "albedo") {
                    const personalKey = `PERSONAL@${tex.dimension[0]}_${tex.dimension[1]}`;
                    if (!personalMap.has(personalKey)) personalMap.set(personalKey, new Map());
                    const hashMap = personalMap.get(personalKey)!;

                    if (!hashMap.has(tex.hash)) hashMap.set(tex.hash, {
                        textureData: [],
                        layer: hashMap.size
                    });
                    hashMap.get(tex.hash)?.textureData!.push(key as keyof standardMaterialTextureInfo);
                }
            }
        }
        for (const [material, bucket] of personalBuckets) {
            for (const [name, hashMap] of bucket) {
                const wgslName = name.replace('@', "_");
                const textureMap=new Map<number, (keyof standardMaterialTextureInfo)[]>();
                hashMap.forEach((data,hash) => {
                    textureMap.set(hash,data.textureData)
                })
                material.descriptor.bindGroupEntries.push({
                    bindingPoint: material.bindingCounter,
                    additional: {
                        textureArray: {
                            textureMap,
                            size: name.split('@')[1].split("_").map(Number) as [number, number],
                            isGlobal: false
                        }
                    }
                });
                material.descriptor.layoutEntries.push({
                    binding: material.bindingCounter,
                    texture: {sampleType: "float", viewDimension: "2d-array"},
                    visibility: GPUShaderStage.FRAGMENT
                });
                material.shaderDescriptor.bindings.push({
                    binding: material.bindingCounter,
                    group: 1,
                    wgslType: "texture_2d_array<f32>",
                    name: wgslName,
                    address: "var"
                });

                for (const [, data] of hashMap) {
                    data.textureData.forEach(key => {
                        material.shaderDescriptor.compileHints.push({
                            replaceKeyword: wgslName,
                            searchKeyword: `${key}.texture`
                        });

                        material.shaderDescriptor.compileHints.push({
                            replaceKeyword: `${data.layer}`,
                            searchKeyword: `${key}.textureIndex`
                        });
                    });
                }
                material.bindingCounter++;
            }
        }

        for (const [samplerKey, map] of samplerBuckets) {
            for (const [material, {sampler, textures}] of map) {
                material.descriptor.bindGroupEntries.push({
                    bindingPoint: material.bindingCounter,
                    sampler: samplerKey === "SAMPLER_DEFAULT" ? BaseLayer.samplers.ibl : sampler
                });
                material.descriptor.layoutEntries.push({
                    binding: material.bindingCounter,
                    sampler: {type: "filtering"},
                    visibility: GPUShaderStage.FRAGMENT
                });
                material.shaderDescriptor.bindings.push({
                    name: samplerKey,
                    wgslType: "sampler",
                    address: "var",
                    binding: material.bindingCounter,
                    group: 1
                });

                textures.forEach(texture => {
                    material.shaderDescriptor.compileHints.push({
                        searchKeyword: `${texture}.sampler`,
                        replaceKeyword: samplerKey
                    });
                });
                material.bindingCounter++;
            }
        }

        for (const [name, hashMap] of sharedBuckets) {
            for (const [hash, data] of hashMap) {
                for (const [material, keys] of data.materials) {
                    const wgslName = name.replace('@', "_");
                    const alreadyBound = material.shaderDescriptor.bindings.some(b => b.name === wgslName);
                    if (!alreadyBound) {
                        material.descriptor.bindGroupEntries.push({
                            bindingPoint: material.bindingCounter,
                            additional: {
                                textureArray: {
                                    textureMap: new Map([[hash, keys]]),
                                    size: name.split('@')[1].split("_").map(Number) as [number, number],
                                    isGlobal: true
                                }
                            }
                        });
                        material.descriptor.layoutEntries.push({
                            binding: material.bindingCounter,
                            texture: {sampleType: "float", viewDimension: "2d-array"},
                            visibility: GPUShaderStage.FRAGMENT
                        });
                        material.shaderDescriptor.bindings.push({
                            binding: material.bindingCounter,
                            group: 1,
                            wgslType: "texture_2d_array<f32>",
                            name: wgslName,
                            address: "var"
                        });
                        material.bindingCounter++;
                    }
                    keys.forEach(key => {
                        material.shaderDescriptor.compileHints.push({
                            replaceKeyword: wgslName,
                            searchKeyword: `${key}.texture`
                        });
                        material.shaderDescriptor.compileHints.push({
                            replaceKeyword: `${data.layer}`,
                            searchKeyword: `${key}.textureIndex`
                        });
                    });
                }
            }
        }
    }


    findGlobalArray(width: number, height: number): string | null {
        for (const key of GPUCache.globalTextureArrayCache.keys()) {
            const [, size] = key.split("@");
            const [w, h] = size.split("_").map(Number);
            if (w === width && h === height) {
                const textureArray = GPUCache.globalTextureArrayCache.get(key)!;
                if (textureArray.depthOrArrayLayers < 50) {
                    return key;
                }
            }
        }
        return null;
    }


    removeTextureFromTextureArray(targetTextureHash: number, commandEncoder: GPUCommandEncoder, destroyPending: Set<GPUTexture>) {
        const textureInfo = GPUCache.textureLocationCache.get(targetTextureHash);
        if (!textureInfo) throw new Error("hash is not valid");

        const cacheKey: ("globalTextureArrayCache" | "personalTextureArrayCache") = textureInfo.isGlobal ? "globalTextureArrayCache" : "personalTextureArrayCache";
        const oldTextureArray = GPUCache[cacheKey].get(textureInfo.textureArrayKey);
        if (!oldTextureArray) throw new Error("something went wrong");

        const hashesSharingTexture = textureInfo.textureArrayKey.split("@")[0].split("|").map(i => +i);
        hashesSharingTexture.splice(hashesSharingTexture.indexOf(targetTextureHash), 1);

        if (hashesSharingTexture.length > 0) {
            const newTexture = BaseLayer.device.createTexture({
                size: {
                    width: oldTextureArray.width,
                    height: oldTextureArray.height,
                    depthOrArrayLayers: oldTextureArray.depthOrArrayLayers - 1
                },
                format: oldTextureArray.format,
                usage: oldTextureArray.usage
            })

            const newTextureKey = `${hashesSharingTexture.join('|')}@${textureInfo.textureArrayKey.split("@")[1]}`;

            hashesSharingTexture.forEach(hash => {
                const hashTextureInfo = GPUCache.textureLocationCache.get(hash)!;
                if (!hashesSharingTexture) throw new Error("something went wrong");
                const newLayer = hashTextureInfo.layer < textureInfo.layer ? hashTextureInfo.layer : hashTextureInfo.layer - 1;
                hashTextureInfo.textureArrayKey = newTextureKey;

                commandEncoder.copyTextureToTexture({
                    texture: oldTextureArray,
                    origin: [0, 0, hashTextureInfo.layer]
                }, {
                    texture: newTexture,
                    origin: [0, 0, newLayer]
                }, {
                    width: oldTextureArray.width,
                    height: oldTextureArray.height,
                    depthOrArrayLayers: 1
                })
                hashTextureInfo.layer = newLayer;
            })
            GPUCache[cacheKey].set(newTextureKey, newTexture)
        }
        destroyPending.add(oldTextureArray);
        GPUCache[cacheKey].delete(textureInfo.textureArrayKey)
    }

    addTextureToTextureArray(targetTextureHash: number, targetTextureArrayKey: string, isDestinationGlobal: boolean, commandEncoder: GPUCommandEncoder, setLocation: boolean) {
        const textureInfo = GPUCache.textureLocationCache.get(targetTextureHash);
        if (!textureInfo) throw new Error("hash is not valid");
        const sourceCacheKey: ("globalTextureArrayCache" | "personalTextureArrayCache") = textureInfo.isGlobal ? "globalTextureArrayCache" : "personalTextureArrayCache";
        const destinationCacheKey: ("globalTextureArrayCache" | "personalTextureArrayCache") = isDestinationGlobal ? "globalTextureArrayCache" : "personalTextureArrayCache";

        const sourceTextureArray = GPUCache[sourceCacheKey].get(textureInfo.textureArrayKey);
        if (!sourceTextureArray) throw new Error("something went wrong");

        const destinationTextureArray = GPUCache[destinationCacheKey].get(targetTextureArrayKey);
        if (!destinationTextureArray) throw new Error("something went wrong");

        const hashesSharingTexture = new Set(textureInfo.textureArrayKey.split("@")[0].split("|").map(i => +i))
        hashesSharingTexture.add(targetTextureHash);

        const newTexture = BaseLayer.device.createTexture({
            size: {
                width: destinationTextureArray.width,
                height: destinationTextureArray.height,
                depthOrArrayLayers: hashesSharingTexture.size
            },
            format: destinationTextureArray.format,
            usage: destinationTextureArray.usage
        })

        if (setLocation) {
            textureInfo.layer = destinationTextureArray.depthOrArrayLayers
            textureInfo.isGlobal = isDestinationGlobal;
        }


        const newTextureKey = `${Array.from(hashesSharingTexture).join('|')}@${textureInfo.textureArrayKey.split("@")[1]}`;

        hashesSharingTexture.forEach(hash => {
            const hashTextureInfo = GPUCache.textureLocationCache.get(hash)!;
            if (!hashesSharingTexture) throw new Error("something went wrong");
            if (hash === targetTextureHash && setLocation) {
                hashTextureInfo.textureArrayKey = newTextureKey;
            } else if (hash !== targetTextureHash) {
                hashTextureInfo.textureArrayKey = newTextureKey;
            }
            commandEncoder.copyTextureToTexture({
                texture: hash === targetTextureHash ? sourceTextureArray : destinationTextureArray,
                origin: [0, 0, hash === targetTextureHash ? textureInfo.layer : hashTextureInfo.layer]
            }, {
                texture: newTexture,
                origin: [0, 0, hash === targetTextureHash ? newTexture.depthOrArrayLayers - 1 : hashTextureInfo.layer]
            }, {
                width: destinationTextureArray.width,
                height: destinationTextureArray.height,
                depthOrArrayLayers: 1
            })
        })
        destinationTextureArray.destroy();
        GPUCache[destinationCacheKey].delete(targetTextureArrayKey)
        GPUCache[destinationCacheKey].set(newTextureKey, newTexture)
    }

    findPersonalArrayKey(targetTextureHash: number, width: number, height: number) {
        const textureRequests = BaseLayer.hasher.hashToRequests.get(targetTextureHash);
        if (!textureRequests) throw new Error("hash is not valid");
        if (textureRequests.size !== 1) throw new Error("no or more then 1 material is using this texture");

        let personalTextureHash: null | number = null;
        for (const texture in Array.from(textureRequests)[0][0].textureInfo) {
            const item = Array.from(textureRequests)[0][0].textureInfo[texture as keyof standardMaterialTextureInfo]
            if (item.shareInfo !== null && item.hash !== null && item.dimension && item.dimension[0] === width && item.dimension[1] === height) {
                personalTextureHash = item.hash;
                break;
            }
        }
        if (personalTextureHash !== null) {
            const textureInfo = GPUCache.textureLocationCache.get(personalTextureHash)!;
            return textureInfo?.textureArrayKey ?? null;
        }

        return null
    }

    isGlobalTextureArray(textureArrayKey: string) {
        return GPUCache.globalTextureArrayCache.has(textureArrayKey);
    }

    createTextureArray(hash: number, width: number, height: number, isGlobal: boolean, setLocation: boolean) {
        const cacheKey: ("globalTextureArrayCache" | "personalTextureArrayCache") = isGlobal ? "globalTextureArrayCache" : "personalTextureArrayCache";

        const texture = BaseLayer.device.createTexture({
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
            size: {
                width,
                height,
                depthOrArrayLayers: 1
            },
        });
        const newTextureKey = `${hash}@${width}_${height}`
        if (setLocation) {
            GPUCache.textureLocationCache.set(hash, {
                textureArrayKey: newTextureKey,
                height,
                width,
                layer: 0,
                isGlobal
            })
        }
        GPUCache[cacheKey].set(newTextureKey, texture)
    }

    putDataAtFirstLayer(hash: number, width: number, height: number) {
        const textureKey = `${hash}@${width}_${height}`;
        const texture = GPUCache.personalTextureArrayCache.get(textureKey)!;

        const data = BaseLayer.hasher.userLoadedTextureHashToData.get(hash)!;
        BaseLayer.device.queue.writeTexture(
            {
                texture: texture,
                origin: [0, 0, 0]
            },
            data,
            {
                bytesPerRow: width * 4,
                rowsPerImage: height
            },
            {width: width, height: height, depthOrArrayLayers: 1}
        );
    }

    setOverrides(mat: MaterialInstance) {
        for (const textureKey in mat.textureInfo) {
            const item = mat.textureInfo[textureKey as keyof standardMaterialTextureInfo];
            mat.shaderDescriptor.overrides[mat.textureInfo[textureKey as keyof standardMaterialTextureInfo].override] = item.hash !== null
        }
    }

    setDescriptorAfterUpdate(mat: MaterialInstance) {
        /// not ready yet
        mat.bindingCounter = 0;
        mat.shaderCode = null;
        mat.shaderDescriptor = {
            ...mat.shaderDescriptor,
            compileHints: [],
            bindings: []
        }
        mat.descriptor.bindGroupEntries = []
        mat.descriptor.layoutEntries = []

        const textureInfo = new Map(new Map<number, Set<keyof standardMaterialTextureInfo>>());
        const samplerInfo = new Map<string, {
            sampler: GPUSampler,
            textures: Set<keyof standardMaterialTextureInfo>
        }>();

        for (const textureKey in mat.textureInfo) {
            const item = mat.textureInfo[textureKey as keyof standardMaterialTextureInfo];
            if (item.hash !== null) {
                if (textureKey !== "albedo") {
                    if (textureInfo.has(item.hash)) {
                        textureInfo.get(item.hash)?.add(textureKey as keyof standardMaterialTextureInfo)
                    } else {
                        textureInfo.set(item.hash, new Set([textureKey as keyof standardMaterialTextureInfo]))
                    }
                }
                const sampler = GPUCache.textureGenerator.getSampler(item.samplerKey) ?? BaseLayer.samplers.default
                if (samplerInfo.has(item.samplerKey)) {
                    samplerInfo.get(item.samplerKey)!.textures.add(textureKey as keyof standardMaterialTextureInfo)
                } else {
                    samplerInfo.set(item.samplerKey, {
                        textures: new Set([textureKey as keyof standardMaterialTextureInfo]),
                        sampler: sampler
                    })
                }
            }
        }

        samplerInfo.forEach((item, wgslName) => {
            mat.descriptor.layoutEntries.push({
                binding: mat.bindingCounter,
                sampler: {
                    type: "filtering"
                },
                visibility: GPUShaderStage.FRAGMENT
            })

            mat.descriptor.bindGroupEntries.push({
                bindingPoint: mat.bindingCounter,
                sampler: item.sampler
            })

            mat.shaderDescriptor.bindings.push({
                binding: mat.bindingCounter,
                group: 1,
                wgslType: "sampler",
                name: wgslName,
                address: "var"
            })

            item.textures.forEach(texture => {
                mat.shaderDescriptor.compileHints.push({
                    searchKeyword: `${texture}.sampler`,
                    replaceKeyword: wgslName
                })
            })
            mat.bindingCounter++
        })
        const bindMap = new Map<string, {
            hash: number,
            textures: (keyof standardMaterialTextureInfo)[]
        }[]>

        textureInfo.forEach((textures, hash) => {
            const hashInfo = GPUCache.textureLocationCache.get(hash)!;

            if (bindMap.has(hashInfo.textureArrayKey)) {
                bindMap.get(hashInfo.textureArrayKey)!.push({
                    hash,
                    textures: Array.from(textures)
                })
            } else {
                bindMap.set(hashInfo.textureArrayKey, [{
                    hash,
                    textures: Array.from(textures)
                }])
            }
        })
        bindMap.forEach((item) => {
            const hashInfo = GPUCache.textureLocationCache.get(item[0].hash)!;
            const wgslName = `${hashInfo.isGlobal ? `SHARE` : 'PERSONAL'}_${hashInfo.width}_${hashInfo.height}`;

            const textureMap = new Map<number, (keyof standardMaterialTextureInfo)[]>();

            item.forEach((data) => {
                textureMap.set(data.hash, data.textures)
            })

            mat.descriptor.bindGroupEntries.push({
                bindingPoint: mat.bindingCounter,
                additional: {
                    textureArray: {
                        textureMap,
                        size: [hashInfo.width, hashInfo.height],
                        isGlobal: hashInfo.isGlobal
                    }
                }
            })
            mat.descriptor.layoutEntries.push({
                binding: mat.bindingCounter,
                texture: {
                    sampleType: "float",
                    viewDimension: "2d-array"
                },
                visibility: GPUShaderStage.FRAGMENT
            })
            mat.shaderDescriptor.bindings.push({
                binding: mat.bindingCounter,
                group: 1,
                wgslType: "texture_2d_array<f32>",
                name: wgslName,
                address: "var"
            })
            mat.bindingCounter++

            item.forEach((data) => {
                const hashInfo = GPUCache.textureLocationCache.get(data.hash)!;
                data.textures.forEach(textureKey => {
                    mat.shaderDescriptor.compileHints.push({
                        replaceKeyword: wgslName,
                        searchKeyword: `${textureKey}.texture`
                    })

                    mat.shaderDescriptor.compileHints.push({
                        replaceKeyword: `${hashInfo.layer}`,
                        searchKeyword: `${textureKey}.textureIndex`
                    })
                })
            })
        })

        if (mat.textureInfo.albedo.hash) {
            const albedo = GPUCache.visualTexturesCache.get(mat.textureInfo.albedo.hash)!;

            mat.descriptor.bindGroupEntries.push({
                bindingPoint: mat.bindingCounter,
                textureDescriptor: {
                    texture: albedo,
                    viewDescriptor: {}
                }
            })

            mat.descriptor.layoutEntries.push({
                binding: mat.bindingCounter,
                texture: {
                    sampleType: "float"
                },
                visibility: GPUShaderStage.FRAGMENT
            })
            mat.shaderDescriptor.bindings.push({
                binding: mat.bindingCounter,
                group: 1,
                wgslType: "texture_2d<f32>",
                name: "baseColorTexture",
                address: "var"
            })
            mat.bindingCounter++
        }

        mat.descriptor.bindGroupEntries.push({
            bindingPoint: mat.bindingCounter,
            buffer: mat.materialFactors,
        })
        mat.descriptor.layoutEntries.push({
            binding: mat.bindingCounter,
            buffer: {
                type: "uniform"
            },
            visibility: GPUShaderStage.FRAGMENT
        })
        mat.shaderDescriptor.bindings.push({
            name: 'materialFactors',
            wgslType: 'MaterialFactors',
            address: 'var<uniform>',
            binding: mat.bindingCounter,
            group: 1
        })
        mat.bindingCounter++
        console.log(mat.descriptor)
    }

    setMaterialHashes(mat: MaterialInstance) {
        const hash = BaseLayer.hasher.hashBindGroupLayout(mat.descriptor.layoutEntries)
        BaseLayer.gpuCache.appendBindGroupLayout(mat.descriptor.layoutEntries,
            hash,
            Array.from(mat.primitives)
        )
        mat.setHashes("bindGroupLayout", hash)
        mat.bindGroupLayout = (BaseLayer.gpuCache.getResource(hash, "bindGroupLayoutMap") as any).layout as any

        const entries = GPUCache.getEntriesNonAsync(mat)
        mat.bindGroup = BaseLayer.device.createBindGroup({
            label: `bindGroup ${mat.name} test`,
            entries,
            layout: mat.bindGroupLayout
        })
        mat.compileShader();
        const geometryLayoutHashes = new Map<number, number>();
        mat.primitives.forEach((p) => {
            geometryLayoutHashes.set(p.id, p.geometry.hashes.bindGroupLayout.new!)
        })
        const shaderCodesHashes = BaseLayer.gpuCache.createShaderCodeHashes(Array.from(mat.primitives), false)
        const pipelineLayoutsHashes = BaseLayer.gpuCache.createPipelineLayoutHashes(Array.from(mat.primitives), geometryLayoutHashes)
        const pipelineHashes = BaseLayer.gpuCache.createPipelineHashes(shaderCodesHashes, pipelineLayoutsHashes)

        pipelineHashes.forEach((pipelineHash, key) => {
            const {side, id: primitiveId} = unpackPrimitiveKey(key)
            const pipelineLayout = pipelineLayoutsHashes.get(primitiveId)!


            const shaderCodeHash = shaderCodesHashes.get(primitiveId)!
            if (!pipelineLayout) throw new Error("pipelineLayout is not set")
            const primitive = pipelineLayout?.primitive!

            const primitiveHashes: PrimitiveHashes = {
                shader: {
                    vertex: shaderCodeHash[1],
                    fragment: shaderCodeHash[0],
                },
                pipeline: pipelineHash,
                pipelineLayout: pipelineLayout.hash,
            }

            primitive.setPrimitiveHashes(primitiveHashes, side!)
        })

        mat.primitives.forEach((p) => {
            p.sides.forEach((side) => {
                p.setPipeline(side)
            })
        })
    }

    addToInvolvedMats(mats: Set<MaterialInstance>, textureArrayKey: string) {
        const hashesSharingTexture = textureArrayKey.split("@")[0].split("|").map(i => +i);

        hashesSharingTexture?.forEach((_, hash) => {
            const reqs = BaseLayer.hasher.hashToRequests.get(hash!);

            reqs?.forEach((_, mat) => {
                mats.add(mat)
            })
        })
    }

    updateTexture(mat: MaterialInstance) {
        const destroyPending = new Set<GPUTexture>();
        const involvedMats = new Set<MaterialInstance>();
        const commandEncoder = BaseLayer.device.createCommandEncoder();
        const updates = Array.from(mat.updateAbleTexture)
        const matOldHashes: Map<(number | null), (keyof standardMaterialTextureInfo)[]> = new Map()
        updates.forEach(([key, value]) => {
            const oldHash = mat.textureInfo[key].hash
            if (matOldHashes.has(oldHash)) {
                matOldHashes.get(oldHash)?.push(key)
            } else {
                matOldHashes.set(oldHash, [key])
            }


            mat.textureInfo[key].hash = value.hash;
            mat.textureInfo[key].dimension = [value.width, value.height];
            if (BaseLayer.hasher.hashToRequests.has(value.hash)) {
                const item = BaseLayer.hasher.hashToRequests.get(value.hash)!;
                // adding textureKey

                if (item.has(mat)) {
                    item.get(mat)!.add(key)
                } else {
                    item.set(mat, new Set([key]))
                }
            } else {
                BaseLayer.hasher.hashToRequests.set(value.hash, new Map([[mat, new Set([key])]]))
            }

            const oldHashRequests = BaseLayer.hasher.hashToRequests.get(oldHash!);
            const newHashRequests = BaseLayer.hasher.hashToRequests.get(value.hash);

            oldHashRequests?.forEach((_, mat) => {
                involvedMats.add(mat)
            })

            newHashRequests?.forEach((_, mat) => {
                involvedMats.add(mat)
            })

        })

        for (const texture in mat.textureInfo) {
            const item = mat.textureInfo[texture as keyof standardMaterialTextureInfo]
            if (matOldHashes.has(item.hash)) matOldHashes.delete(item.hash)
        }
        matOldHashes.forEach((textures, hash) => {
            if (hash !== null) {
                const textureInfo = GPUCache.textureLocationCache.get(hash)!;
                const requests = BaseLayer.hasher.hashToRequests.get(hash!);
                const textureList = requests?.get(mat)!;
                textures.forEach(texture => {
                    textureList.delete(texture)
                })
                if (textureList.size === 0) {
                    requests?.delete(mat)
                }
                if (requests?.size === 0) {

                    BaseLayer.hasher.hashToRequests.delete(hash!)
                    this.removeTextureFromTextureArray(hash, commandEncoder, destroyPending)
                    GPUCache.textureLocationCache.delete(hash!)

                } else if (requests?.size === 1 && this.isGlobalTextureArray(textureInfo.textureArrayKey)) {

                    requests.forEach((keys, mat) => {
                        keys.forEach(key => {
                            mat.textureInfo[key].shareInfo = null
                        })
                    })
                    const findPersonalKey = this.findPersonalArrayKey(hash, textureInfo.width, textureInfo.height);
                    if (findPersonalKey !== null) {
                        this.addToInvolvedMats(involvedMats, findPersonalKey)
                        this.addTextureToTextureArray(hash, findPersonalKey, false, commandEncoder, false)
                        this.removeTextureFromTextureArray(hash, commandEncoder, destroyPending)
                        const layer = GPUCache.personalTextureArrayCache.get(findPersonalKey)!.depthOrArrayLayers - 1;
                        GPUCache.textureLocationCache.set(hash, {
                            textureArrayKey: findPersonalKey,
                            height: textureInfo.height,
                            width: textureInfo.width,
                            layer: layer,
                            isGlobal: false
                        })
                    } else {
                        this.createTextureArray(hash, textureInfo.width, textureInfo.height, false, false)
                        this.addTextureToTextureArray(hash, `${hash}@${textureInfo.width}_${textureInfo.height}`, false, commandEncoder, false)
                        this.removeTextureFromTextureArray(hash, commandEncoder, destroyPending)
                        GPUCache.textureLocationCache.set(hash, {
                            textureArrayKey: `${hash}@${textureInfo.width}_${textureInfo.height}`,
                            height: textureInfo.height,
                            width: textureInfo.width,
                            layer: 0,
                            isGlobal: false
                        })
                    }
                }
            }
        })
        updates.forEach(([key, update]) => {
            const hashInfo = GPUCache.textureLocationCache.get(update.hash);
            if (!hashInfo) {
                const personalKey = this.findPersonalArrayKey(update.hash, update.width, update.height);
                if (personalKey !== null) {
                    this.addToInvolvedMats(involvedMats, personalKey)
                    this.addTextureToTextureArray(update.hash, personalKey, false, commandEncoder, true)
                } else {
                    this.createTextureArray(update.hash, update.width, update.height, false, true)
                    this.putDataAtFirstLayer(update.hash, update.width, update.height)
                }
                mat.textureInfo[key].shareInfo = null;
            } else {
                const requests = BaseLayer.hasher.hashToRequests.get(update.hash)!;
                const isGlobal = hashInfo.isGlobal;
                const requestsArray = Array.from(requests)
                if (!isGlobal) {
                    if (requestsArray[0][0] !== mat || requestsArray.length > 1) {
                        const globalKey = this.findGlobalArray(update.width, update.height)
                        if (globalKey !== null) {
                            this.addToInvolvedMats(involvedMats, globalKey)
                            this.addTextureToTextureArray(update.hash, globalKey, true, commandEncoder, false)
                            this.removeTextureFromTextureArray(update.hash, commandEncoder, destroyPending)
                        } else {
                            this.createTextureArray(update.hash, update.width, update.height, true, false)
                            this.addTextureToTextureArray(update.hash, `${update.hash}@${update.width}_${update.height}`, true, commandEncoder, false)
                            this.removeTextureFromTextureArray(update.hash, commandEncoder, destroyPending)
                            GPUCache.textureLocationCache.set(update.hash, {
                                textureArrayKey: `${update.hash}@${update.width}_${update.height}`,
                                height: update.height,
                                width: update.width,
                                layer: 0,
                                isGlobal: true
                            })
                        }
                    }
                }
                requestsArray.forEach(([mat, textures]) => {
                    textures.forEach((texture) => {
                        mat.textureInfo[texture].shareInfo = {
                            arrayIndex: 0,
                            dimension: `${hashInfo.width}_${hashInfo.height}`
                        }
                    })
                })
            }
        })
        involvedMats.delete(mat)
        involvedMats.forEach((mat) => {
            this.setDescriptorAfterUpdate(mat)
            if (mat instanceof StandardMaterial) {
                SmartRender.shaderGenerator.getStandardCode(mat)
            }
            this.setMaterialHashes(mat)
        })
        BaseLayer.device.queue.submit([commandEncoder.finish()])
        destroyPending.forEach((texture) => {
            texture.destroy()
        })
        console.log(GPUCache.personalTextureArrayCache, GPUCache.globalTextureArrayCache, mat.descriptor)
        this.setOverrides(mat)
        mat.updateAbleTexture.clear()
    }
}