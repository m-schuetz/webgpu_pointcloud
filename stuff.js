
async function initScene(){

	return true;

	let loader = new LASLoader(urlPointcloud);
	await loader.loadHeader();

	let numPoints = loader.header.numPoints;

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

	let elProgress = document.getElementById("progress");

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

	let lasBufferSize = 1000_000 * 64;
	let bufLasTransfer = device.createBuffer({
		size: lasBufferSize,
		usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
	});
	
	let bufLasCompute = device.createBuffer({
		size: lasBufferSize,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	});

	let asyncLoad = async () => {
		let iterator = loader.loadBatches();
		let pointsLoaded = 0;
		for await (let batch of iterator){

			let paramsData = new Uint32Array([pointsLoaded, batch.size]);
			device.defaultQueue.writeBuffer(bufParams, 0, paramsData);

			await bufLasTransfer.mapAsync(GPUMapMode.WRITE, 0, lasBufferSize);
			new Uint8Array(bufLasTransfer.getMappedRange()).set(new Uint8Array(batch.buffer));
			bufLasTransfer.unmap();

			const encoder = device.createCommandEncoder();
			encoder.copyBufferToBuffer(bufLasTransfer, 0, bufLasCompute, 0, lasBufferSize);
			device.defaultQueue.submit([encoder.finish()]);


			//let tmp = new Uint8Array(batch.size * 64);
			//tmp.set(new Uint8Array(batch.buffer));
			//device.defaultQueue.writeBuffer(lasbuffer, 0, tmp);

			// if(pointsLoaded < 500_000){
				let csBindGroup = device.createBindGroup({
					layout: pipeline.getBindGroupLayout(0),
					entries: [{
						binding: 0,
						resource: {
							buffer: bufLasCompute,
							offset: 0,
							size: batch.size * 64,
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

				const commandEncoder = device.createCommandEncoder();

				let passEncoder = commandEncoder.beginComputePass();
				passEncoder.setPipeline(pipeline);
				passEncoder.setBindGroup(0, csBindGroup);
				passEncoder.dispatch(batch.size);
				passEncoder.endPass();

				device.defaultQueue.submit([commandEncoder.finish()]);
			// }else{
			// 	device.defaultQueue.writeBuffer(bufPositions, 12 * pointsLoaded, batch.positions);
			// 	device.defaultQueue.writeBuffer(bufColors, 16 * pointsLoaded, batch.colors);
			// }






			pointsLoaded += batch.size;

			let progress = pointsLoaded / loader.header.numPoints;
			let strProgress = `${parseInt(progress * 100)}`;
			let msg = `loading: ${strProgress}%`;
			elProgress.innerHTML = msg;

			sceneObject.n = pointsLoaded;
		}

		elProgress.innerHTML = `loading finished`;
	};

	asyncLoad();

	scene.pointcloud = sceneObject;
}
