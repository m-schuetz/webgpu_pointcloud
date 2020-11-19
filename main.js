
// after https://github.com/austinEng/webgpu-samples/blob/master/src/examples/rotatingCube.ts


import {LASLoader, DropLasLoader} from './LASLoader.js';
import { mat4, vec3 } from './libs/gl-matrix.js';
import {cube, pointCube} from "./cube.js";
import * as shaders from "./shaders.js";

//let urlPointcloud = "http://mschuetz.potree.org/lion/lion.las";
let urlPointcloud = "./heidentor.las";

let adapter = null;
let device = null;
let canvas = null;
let context = null;
let swapChain = null;
let depthTexture = null;

let cameraDistance = 20;

let frame = 0;

let scene = {
	pointcloud: null,
};

let aspect = 3 / 4;
let projectionMatrix = mat4.create();
mat4.perspective(projectionMatrix, (2 * Math.PI) / 5, aspect, 0.1, 1000.0);

function getTransformationMatrix() {

	aspect = canvas.clientWidth / canvas.clientHeight;
	mat4.perspective(projectionMatrix, (2 * Math.PI) / 5, aspect, 0.1, cameraDistance * 2.0);

	let viewMatrix = mat4.create();
	mat4.translate(viewMatrix, viewMatrix, vec3.fromValues(0, 0, -cameraDistance));
	let now = Date.now() / 1000;

	mat4.rotate(
		viewMatrix,
		viewMatrix,
		now,
		vec3.fromValues(0, 1, 0)
	);

	let modelViewProjectionMatrix = mat4.create();
	mat4.multiply(modelViewProjectionMatrix, projectionMatrix, viewMatrix);

	return modelViewProjectionMatrix;
}


async function init(){
	adapter = await navigator.gpu.requestAdapter();
	device = await adapter.requestDevice();

	canvas = document.getElementById("canvas");
	context = canvas.getContext("gpupresent");

	swapChain = context.configureSwapChain({
		device,
		format: "bgra8unorm",
	});

	depthTexture = device.createTexture({
		size: {
			width: canvas.width,
			height: canvas.height,
			depth: 1,
		},
		format: "depth24plus-stencil8",
		usage: GPUTextureUsage.OUTPUT_ATTACHMENT,
	});

}



function createBuffer(data){

	let vbos = [];

	for(let entry of data.buffers){
		let {name, buffer} = entry;

		let vbo = device.createBuffer({
			size: buffer.byteLength,
			usage: GPUBufferUsage.VERTEX,
			mappedAtCreation: true,
		});

		let type = buffer.constructor;
		new type(vbo.getMappedRange()).set(buffer);
		vbo.unmap();

		vbos.push({
			name: name,
			vbo: vbo,
		});
	}

	return vbos;
}

function createPipeline(vbos){

	const pipeline = device.createRenderPipeline({
		vertexStage: {
			module: device.createShaderModule({code: shaders.vs}),
			entryPoint: "main",
		},
		fragmentStage: {
			module: device.createShaderModule({code: shaders.fs}),
			entryPoint: "main",
		},
		primitiveTopology: "point-list",
		depthStencilState: {
			depthWriteEnabled: true,
			depthCompare: "less",
			format: "depth24plus-stencil8",
		},
		vertexState: {
			vertexBuffers: [
				{ // position
					arrayStride: 3 * 4,
					attributes: [{ 
						shaderLocation: 0,
						offset: 0,
						format: "float3",
					}],
				},{ // color
					arrayStride: 4 * 4,
					attributes: [{ 
						shaderLocation: 1,
						offset: 0,
						format: "float4",
					}],
				},
			],
		},
		rasterizationState: {
			cullMode: "none",
		},
		colorStates: [
			{
				format: "bgra8unorm",
			},
		],
	});

	return pipeline;
}


function createComputeLasToVboPipeline(){
	let pipeline = device.createComputePipeline({
		computeStage: {
			module: device.createShaderModule({code: shaders.csLasToVBO}),
			entryPoint: "main",
		}
	});

	return pipeline;
}

async function run(){

	await init()
	// initScene();

	let vbos = createBuffer(pointCube);
	let pipeline = createPipeline();
	let csLasToVboPipeline = createComputeLasToVboPipeline();

	const uniformBufferSize = 4 * 16; // 4x4 matrix

	const uniformBuffer = device.createBuffer({
		size: uniformBufferSize,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});

	const uniformBindGroup = device.createBindGroup({
		layout: pipeline.getBindGroupLayout(0),
		entries: [
		{
			binding: 0,
			resource: {
			buffer: uniformBuffer,
			},
		},
		],
	});




	let loop = () => {
		frame++;

		const transformationMatrix = getTransformationMatrix();
		device.defaultQueue.writeBuffer(
			uniformBuffer,
			0,
			transformationMatrix.buffer,
			transformationMatrix.byteOffset,
			transformationMatrix.byteLength
		);

		let renderPassDescriptor = {
			colorAttachments: [
				{
					attachment: swapChain.getCurrentTexture().createView(),
					loadValue: { r: 0.5, g: 0.5, b: 0.5, a: 1.0 },
				},
			],
			depthStencilAttachment: {
				attachment: depthTexture.createView(),

				depthLoadValue: 1.0,
				depthStoreOp: "store",
				stencilLoadValue: 0,
				stencilStoreOp: "store",
			},
			sampleCount: 16,
		};

		if(scene.pointcloud){

			const commandEncoder = device.createCommandEncoder();

			{
				let passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
				passEncoder.setPipeline(pipeline);
				passEncoder.setBindGroup(0, uniformBindGroup);

				passEncoder.setVertexBuffer(0, scene.pointcloud.bufPositions);
				passEncoder.setVertexBuffer(1, scene.pointcloud.bufColors);

				//for(let i = 0; i < vbos.length; i++){
				//	passEncoder.setVertexBuffer(i, vbos[i].vbo);
				//}

				passEncoder.draw(scene.pointcloud.n, 1, 0, 0);
				passEncoder.endPass();
			}

			device.defaultQueue.submit([commandEncoder.finish()]);
		}

		requestAnimationFrame(loop);
	}
	loop();

}





{
	async function loadDroppedLas(file){

		let batchSize = 500_000; 

		let tStart = performance.now();

		let loader = new DropLasLoader(file);
		let header = await loader.loadHeader();
		let numPoints = header.numPoints;

		{
			let dx = header.max[0] - header.min[0];
			let dy = header.max[1] - header.min[1];
			let dz = header.max[2] - header.min[2];
			let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
			cameraDistance = d;
			console.log(cameraDistance);
		}

		let descriptorPos = {
			size: 12 * numPoints,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		};
		let bufPositions = device.createBuffer(descriptorPos);

		let descriptorCol = {
			size: 16 * numPoints,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		};
		let bufColors = device.createBuffer(descriptorCol);

		let sceneObject = {
			n: 0,
			bufPositions: bufPositions,
			bufColors: bufColors,
		};
		scene.pointcloud = sceneObject;

		let pointsLoaded = 0;
		let bytesPerPoint = header.pointDataRecordLength;

		let onFinish = () => {
			let duration = performance.now() - tStart;
			let pointsPerSecond = (1000 * pointsLoaded / duration) / 1_000_000;
			console.log(`loading finished in ${duration / 1000}s`);
			console.log(`${pointsPerSecond.toFixed(1)}M Points/s`);
		};

		let batches = [];

		let pointsHandled = 0;
		while(pointsHandled < numPoints){

			// load batch data
			let pointsLeft = numPoints - pointsHandled;
			let currentBatchSize = Math.min(batchSize, pointsLeft);
			let start = header.offsetToPointData + pointsHandled * bytesPerPoint;
			let end = start + currentBatchSize * bytesPerPoint;

			let blob = file.slice(start, end);
			
			let batch = {
				numPoints: currentBatchSize,
				pointOffset: pointsHandled,
				start: start,
				end: end,
				blob: blob,
			};

			batches.push(batch);
			pointsHandled += currentBatchSize;
		}

		let batchesPending = batches.length;

		let numConcurrent = 5;
		let loadBuffers = [];

		let lasBufferSize = batchSize * 64;
		for(let i = 0; i < numConcurrent; i++){
			let pipeline = device.createComputePipeline({
				computeStage: {
					module: device.createShaderModule({code: shaders.csLasToVBO}),
					entryPoint: "main",
				}
			});

			let bufParams = device.createBuffer({
				size: 8,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			});

			let bufLasTransfer = device.createBuffer({
				size: lasBufferSize,
				usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
			});
			
			let bufLasCompute = device.createBuffer({
				size: lasBufferSize,
				usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			});

			let loadBuffer = {
				pipeline: pipeline,
				bufParams: bufParams,
				bufLasTransfer: bufLasTransfer,
				bufLasCompute: bufLasCompute,
			};

			loadBuffers.push(loadBuffer);
		}


		let handler = (batch) => {

			batch.blob.arrayBuffer().then(async buffer => {

				batchesPending--;

				let lb = loadBuffers.shift();
				let {pipeline, bufParams, bufLasTransfer, bufLasCompute} = lb;

				// console.log(`sending blob to gpu: ${batch.start.toLocaleString()} - ${batch.end.toLocaleString()}`);
				console.log([batch.pointOffset, batch.numPoints]);

				// TODO: if multiple tasks try to mapAsync at the same time, one might pass and the other might error because one has already mapped the buffer
				// if mapAsync fails, perhabs try again later, e.g., with setTimeout(1ms).
				await bufLasTransfer.mapAsync(GPUMapMode.WRITE, 0, lasBufferSize);
				new Uint8Array(bufLasTransfer.getMappedRange()).set(new Uint8Array(buffer));
				bufLasTransfer.unmap();

				const commandEncoder = device.createCommandEncoder();

				// send to gpu
				let paramsData = new Uint32Array([batch.pointOffset, batch.numPoints]);
				device.defaultQueue.writeBuffer(bufParams, 0, paramsData);

				commandEncoder.copyBufferToBuffer(bufLasTransfer, 0, bufLasCompute, 0, lasBufferSize);

				// parse with compute shader
				let csBindGroup = device.createBindGroup({
					layout: pipeline.getBindGroupLayout(0),
					entries: [{
						binding: 0,
						resource: {
							buffer: bufLasCompute,
							offset: 0,
							size: batch.numPoints * 64,
						}
					},{
						binding: 1,
						resource: {
							buffer: bufPositions,
							offset: 0,
							size: bufPositions.byteLength,
						}
					},{
						binding: 2,
						resource: {
							buffer: bufColors,
							offset: 0,
							size: bufColors.byteLength,
						}
					},{
						binding: 3,
						resource: {
							buffer: bufParams,
							offset: 0,
							size: bufParams.byteLength,
						}
					}],
				});

				let passEncoder = commandEncoder.beginComputePass();
				passEncoder.setPipeline(pipeline);
				passEncoder.setBindGroup(0, csBindGroup);
				passEncoder.dispatch(batch.numPoints);
				passEncoder.endPass();

				device.defaultQueue.submit([commandEncoder.finish()]);

				pointsLoaded += batch.numPoints;
				sceneObject.n = pointsLoaded;

				loadBuffers.push(lb);

				if(batches.length > 0 && batchesPending > 0){
					let batch = batches.shift();
					handler(batch);
				}
				if(batchesPending === 0){
					onFinish();
				}

			});
		};

		for(let i = 0; i < numConcurrent; i++){
			let batch = batches.shift();
			if(batch){
				handler(batch);
			}
		}



	}


	let dropZone = document.getElementById('canvas');

	// Optional.   Show the copy icon when dragging over.  Seems to only work for chrome.
	dropZone.addEventListener('dragover', function(e) {
		e.stopPropagation();
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
	});

	// Get file data on drop
	dropZone.addEventListener('drop', async function(e) {
		e.stopPropagation();
		e.preventDefault();
		var files = e.dataTransfer.files; 

		for (let file of files) {

			loadDroppedLas(file);

		}
	});
}





run();





