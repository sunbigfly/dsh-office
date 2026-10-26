# 插件索引

在 DSH 自定义插件索引中添加：

```text
https://github.com/sunbigfly/dsh-office/releases/latest/download/index.json
```

索引随发行版发布，每个版本固定到完整 Git 提交 SHA。`npm run release:index` 在提交后生成 `output/index.json`，与安装包、`SHA256SUMS` 一同上传至 Release。
