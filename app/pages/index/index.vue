<template>
	<!-- App 端加载本地打包的 H5（位于 hybrid/html，不参与编译、原样打入安装包） -->
	<web-view src="/hybrid/html/index.html"></web-view>
</template>

<script>
	export default {
		onLoad() {
			// 页面路由、物理返回键、状态栏适配均在 H5（app.js + app-bridge.js）内处理
		}
	}
</script>

<style>
	page {
		background-color: #0f172a;
	}
</style>
