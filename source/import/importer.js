OV.File = class
{
    constructor (file, source)
    {
        this.source = source;
        if (source === OV.FileSource.Url) {
            this.fileUrl = file;
            this.fileObject = null;
            this.name = OV.GetFileName (file);
            this.extension = OV.GetFileExtension (file);
        } else if (source === OV.FileSource.File) {
            this.fileUrl = null;
            this.fileObject = file;
            this.name = OV.GetFileName (file.name);
            this.extension = OV.GetFileExtension (file.name);
        }
        this.content = null;
    }

    SetContent (content)
    {
        this.content = content;
    }
};

OV.FileList = class
{
    constructor ()
    {
        this.files = [];
    }

    FillFromFileUrls (fileList)
    {
        this.Fill (fileList, OV.FileSource.Url);
    }

    FillFromFileObjects (fileList)
    {
        this.Fill (fileList, OV.FileSource.File);
    }

    ExtendFromFileList (files)
    {
        for (let i = 0; i < files.length; i++) {
            let file = files[i];
            if (!this.ContainsFileByPath (file.name)) {
                this.files.push (file);
            }
        }
    }

    GetFiles ()
    {
        return this.files;
    }

    GetContent (onReady)
    {
        let taskRunner = new OV.TaskRunner ();
        taskRunner.Run (this.files.length, {
            runTask : (index, complete) => {
                this.GetFileContent (this.files[index], complete);
            },
            onReady : onReady
        });
    }

    ContainsFileByPath (filePath)
    {
        return this.FindFileByPath (filePath) !== null;
    }

    FindFileByPath (filePath)
    {
        let fileName = OV.GetFileName (filePath).toLowerCase ();
        for (let fileIndex = 0; fileIndex < this.files.length; fileIndex++) {
            let file = this.files[fileIndex];
            if (file.name.toLowerCase () === fileName) {
                return file;
            }
        }
        return null;
    }

    IsOnlySource (source)
    {
        if (this.files.length === 0) {
            return false;
        }
        for (let i = 0; i < this.files.length; i++) {
            let file = this.files[i];
            if (file.source !== source) {
                return false;
            }
        }
        return true;
    }

    Fill (fileList, fileSource)
    {
        this.files = [];
        for (let fileIndex = 0; fileIndex < fileList.length; fileIndex++) {
            let fileObject = fileList[fileIndex];
            let file = new OV.File (fileObject, fileSource);
            this.AddFile (file);
        }
    }

    AddFile (file)
    {
        this.files.push (file);
    }
    
    GetFileContent (file, complete)
    {
        if (file.content !== null) {
            complete ();
            return;
        }
        let loaderPromise = null;
        if (file.source === OV.FileSource.Url) {
            loaderPromise = OV.RequestUrl (file.fileUrl, OV.FileFormat.Binary);
        } else if (file.source === OV.FileSource.File) {
            loaderPromise = OV.ReadFile (file.fileObject, OV.FileFormat.Binary);
        } else {
            complete ();
            return;
        }
        loaderPromise.then ((content) => {
            file.SetContent (content);
        }).catch (() => {
        }).finally (() => {
            complete ();
        });
    }
};

OV.ImportSettings = class
{
    constructor ()
    {
        this.defaultColor = new OV.Color (200, 200, 200);
    }
};

OV.ImportErrorCode =
{
    NoImportableFile : 1,
    ImportFailed : 2,
    UnknownError : 3
};

OV.ImportError = class
{
    constructor (code, message)
    {
        this.code = code;
        this.message = message;
    }
};

OV.ImportResult = class
{
    constructor ()
    {
        this.model = null;
        this.mainFile = null;
        this.upVector = null;
        this.usedFiles = null;
        this.missingFiles = null;
    }
};

OV.ImportBuffers = class
{
    constructor (getBufferCallback)
    {
        this.getBufferCallback = getBufferCallback;
        this.fileBuffers = {};
        this.textureBuffers = {};
    }

    GetFileBuffer (filePath)
    {
        let fileName = OV.GetFileName (filePath);
        let buffer = this.fileBuffers[fileName];
        if (buffer === undefined) {
            buffer = this.getBufferCallback (fileName);
            this.fileBuffers[fileName] = buffer;
        }
        return buffer;
    }

    GetTextureBuffer (filePath)
    {
        let fileName = OV.GetFileName (filePath);
        let buffer = this.textureBuffers[fileName];
        if (buffer === undefined) {
            let textureBuffer = this.getBufferCallback (fileName);
            if (textureBuffer !== null) {
                buffer = {
                    url : OV.CreateObjectUrl (textureBuffer),
                    buffer : textureBuffer
                };
            } else {
                buffer = null;
            }
            this.textureBuffers[fileName] = buffer;
        }
        return buffer;
    }
};

OV.Importer = class
{
    constructor ()
    {
        this.importers = [
            new OV.ImporterObj (),
            new OV.ImporterStl (),
            new OV.ImporterOff (),
            new OV.ImporterPly (),
            new OV.Importer3ds (),
            new OV.ImporterGltf (),
            new OV.ImporterO3dv (),
            new OV.Importer3dm (),
            new OV.ImporterIfc (),
            new OV.ImporterThree ()
        ];
        this.fileList = new OV.FileList ();
        this.model = null;
        this.usedFiles = [];
        this.missingFiles = [];
    }
    
	AddImporter (importer)
	{
		this.importers.push (importer);
	}

    LoadFilesFromUrls (fileList, onReady)
    {
        this.LoadFiles (fileList, OV.FileSource.Url, onReady);
    }

    LoadFilesFromFileObjects (fileList, onReady)
    {
        this.LoadFiles (fileList, OV.FileSource.File, onReady);
    }

    Import (settings, callbacks)
    {
        let mainFile = this.GetMainFile (this.fileList);
        if (mainFile === null || mainFile.file === null || mainFile.file.content === null) {
            callbacks.onError (new OV.ImportError (OV.ImportErrorCode.NoImportableFile, null));
            return;
        }

        this.RevokeModelUrls ();
        this.model = null;
        this.usedFiles = [];
        this.missingFiles = [];
        this.usedFiles.push (mainFile.file.name);

        let importer = mainFile.importer;
        let buffers = new OV.ImportBuffers ((fileName) => {
            let fileBuffer = null;
            let file = this.fileList.FindFileByPath (fileName);
            if (file === null || file.content === null) {
                this.missingFiles.push (fileName);
                fileBuffer = null;
            } else {
                fileBuffer = file.content;
                this.usedFiles.push (fileName);
            }
            return fileBuffer;
        });

        importer.Import (mainFile.file.content, mainFile.file.extension, {
            getDefaultMaterial : () => {
                let material = new OV.Material (OV.MaterialType.Phong);
                material.color = settings.defaultColor;
                return material;
            },
            getFileBuffer : (filePath) => {
                return buffers.GetFileBuffer (filePath);
            },
            getTextureBuffer : (filePath) => {
                return buffers.GetTextureBuffer (filePath);
            },
            onSuccess : () => {
                this.model = importer.GetModel ();
                this.model.SetName (mainFile.file.name);
        
                let result = new OV.ImportResult ();
                result.mainFile = mainFile.file.name;
                result.model = this.model;
                result.usedFiles = this.usedFiles;
                result.missingFiles = this.missingFiles;
                result.upVector = importer.GetUpDirection ();
                callbacks.onSuccess (result);
            },
            onError : () => {
                let message = importer.GetErrorMessage ();
                callbacks.onError (new OV.ImportError (OV.ImportErrorCode.ImportFailed, message));
            },
            onComplete : () => {
                importer.Clear ();
            }
        });
    }

    LoadFiles (fileList, fileSource, onReady)
    {
        let newFileList = new OV.FileList (this.importers);
        if (fileSource === OV.FileSource.Url) {
            newFileList.FillFromFileUrls (fileList);
        } else if (fileSource === OV.FileSource.File) {
            newFileList.FillFromFileObjects (fileList);
        }
        let reset = false;
        if (this.HasMainFile (newFileList)) {
            reset = true;
        } else {
            let foundMissingFile = false;
            for (let i = 0; i < this.missingFiles.length; i++) {
                let missingFile = this.missingFiles[i];
                if (newFileList.ContainsFileByPath (missingFile)) {
                    foundMissingFile = true;
                }
            }
            if (!foundMissingFile) {
                reset = true;
            } else {
                let newFiles = newFileList.GetFiles ();
                this.fileList.ExtendFromFileList (newFiles);
                reset = false;
            }
        }
        if (reset) {
            this.fileList = newFileList;
        }
        this.fileList.GetContent (() => {
            onReady ();
        });
    }

    GetFileList ()
    {
        return this.fileList;
    }

    IsOnlyFileSource (source)
    {
        return this.fileList.IsOnlySource (source);
    }

    HasMainFile (fileList)
    {
        return this.GetMainFile (fileList) !== null;
    }

    GetMainFile (fileList)
    {
        let files = fileList.GetFiles ();
        for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
            let file = files[fileIndex];
            let importer = this.FindImporter (file);
            if (importer !== null) {
                return {
                    file : file,
                    importer : importer
                };
            }
        }
        return null;
    }

    FindImporter (file)
    {
        for (let importerIndex = 0; importerIndex < this.importers.length; importerIndex++) {
            let importer = this.importers[importerIndex];
            if (importer.CanImportExtension (file.extension)) {
                return importer;
            }
        }
        return null;
    }

    RevokeModelUrls ()
    {
        if (this.model === null) {
            return;
        }
        for (let i = 0; i < this.model.MaterialCount (); i++) {
            let material = this.model.GetMaterial (i);
            OV.EnumerateMaterialTextureMaps (material, (texture) => {
                if (texture.url !== null) {
                    OV.RevokeObjectUrl (texture.url);
                }
            });
        }
    }
};
