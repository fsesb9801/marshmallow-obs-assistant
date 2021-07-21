const {app, BrowserWindow, Menu, shell, ipcMain, net, dialog} = require('electron');
const path = require('path');
const windowStateManager = require('electron-window-state-manager');
const Store = require('electron-store');
const contextMenu = require('electron-context-menu');
const fs = require('fs');
const https = require('https');

let mainWindow;
let mmviewWindow;

const APP_NAME = 'マシュマロ配信支援ツール（仮）';

const defaultConfig = {
  defaultUrl: 'https://marshmallow-qa.com/messages/personal',
  baseDomain: 'https://marshmallow-qa.com',
  imageUrl: 'https://media.marshmallow-qa.com/system/images/{uuid}.png',
  imagePath: '',
  textPath: '',
  updateChecker: {
    checkUpdate: true,
    updateUrl: 'https://github.com/hantabaru1014/marshmallow-obs-assistant/releases/latest',
  },
  mmview: {
    useMMView: true,
    mmviewBGColor: 'green',
  }
};
const store = new Store({defaults: defaultConfig});
app.disableHardwareAcceleration();//OBSでウィンドウキャプチャできるように

const isMac = process.platform === 'darwin';
const menuTemplate = [
  ...(isMac ? [{role: 'appMenu'}] : []),
  {
    label: 'File',
    submenu: [
      isMac ? { role: 'close' } : { role: 'quit' },
      {
        label: 'Settings',
        click: () => {
          shell.openPath(store.path);
        }
      }
    ]
  },
  {role: 'viewMenu'},
  {
    label: 'Help',
    submenu: [
      {
        label: 'Version '+app.getVersion()
      },
      {
        label: 'Github',
        click: () => {
          shell.openExternal('https://github.com/hantabaru1014/marshmallow-obs-assistant');
        }
      },
      {
        label: 'Check Update',
        click: () => {
          checkUpdate();
        }
      },
      {
        label: 'About',
        click: () => {
          app.showAboutPanel();
        }
      }
    ]
  }
];
const menu = Menu.buildFromTemplate(menuTemplate);
Menu.setApplicationMenu(menu);
app.setAboutPanelOptions({
  applicationName: APP_NAME,
  applicationVersion: 'version: '+app.getVersion(),
  copyright: '(c) 2020 hantabaru1014@gmail.com'
});

contextMenu({
  menu: actions => [
    actions.copy(),
    actions.copyLink(),
    actions.searchWithGoogle()
  ],
  labels: {
    copy: 'コピー Ctrl+C',
    copyLink: 'リンクのアドレスをコピー',
    searchWithGoogle: 'Googleで検索'
  }
});

const mainWindowState = new windowStateManager('mainWindow', {
  defaultWidth: 800,
  defaultHeight: 600
});
const mmviewWinState = new windowStateManager('mmviewWindow', {
  defaultWidth: 600,
  defaultHeight: 400
});

function createWindow () {
  let dirPath = path.resolve('.');
  if (process.env.PORTABLE_EXECUTABLE_DIR){//electron-builder target = portable
    dirPath = process.env.PORTABLE_EXECUTABLE_DIR;
  }

  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    title: APP_NAME,
    webPreferences: {
      nodeIntegration: false,
      preload: path.join(__dirname, 'main_inject.js')
    },
  });
  if (mainWindowState.maximized) mainWindow.maximize();

  // open marshmallow
  mainWindow.loadURL(store.get('defaultUrl'));

  ipcMain.on('console', (event, arg) => console.log(arg));
  ipcMain.on('showMM', (event, arg) => {
    if (!store.get('mmview.useMMView')) return;
    const receiveObj = JSON.parse(arg);
    if (!mmviewWindow) createMMView();
    if (!mmviewWindow.isVisible()) mmviewWindow.show();
    if (mmviewWindow.webContents.getURL().indexOf('mmview.html') != -1){
      mmviewWindow.loadURL(store.get('baseDomain')+'/messages/'+receiveObj.uuid);
    }else{
      console.log('change MM');
      mmviewWindow.webContents.send('changeMM', receiveObj.text);
    }
    mmviewWindow.focus();
  });
  ipcMain.on('clearMM', (event, arg) => {
    mmviewWindow.webContents.send('hideMM');
  });
  const defaultTextSavePath = path.join(dirPath, 'dl-marshmallow.txt');
  ipcMain.on('dlImage', (event, arg) => {
    const receiveObj = JSON.parse(arg);
    const url = store.get('imageUrl').replace('{uuid}', receiveObj.uuid);
    mainWindow.webContents.downloadURL(url);

    let path = store.get('textPath');
    if (!path) path = defaultTextSavePath;
    fs.writeFile(path, receiveObj.text, (err, data) => {
      if(err) console.error(err);
    });
  });
  ipcMain.on('getGBColor', (event, arg) => {
    event.reply('reply-getGBColor', store.get('mmview.mmviewBGColor'));
  });
  ipcMain.on('reloadMain', (event, arg) => {
    mainWindow.webContents.reload();
  });

  let currentUrl = store.get('defaultUrl');
  mainWindow.webContents.on('did-navigate-in-page', (event, url) => {
    console.log('did-navigate: '+url);
    //inpage navigateだとpreloadのスクリプトが読まれないので苦肉の策
    if (currentUrl !== url){
      currentUrl = url;
      mainWindow.webContents.reload();
    }
  });

  const defaultSavePath = path.join(dirPath, 'dl-marshmallow.png');
  mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
    let path = store.get('imagePath');
    if (!path) path = defaultSavePath;
    item.setSavePath(path);
    console.log(item.getSavePath());
  });

  mainWindow.on('close', () => {
    mainWindowState.saveState(mainWindow);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (!mmviewWindow) return;
    mmviewWindow.close();
  });
  mainWindow.on('page-title-updated', (event, title, expSet) => {
    event.preventDefault();
  });

  mainWindow.webContents.on('new-window', (event, url) => {
    event.preventDefault();
    shell.openExternal(url);
  });
  
  if (store.get('mmview.useMMView')) createMMView();
}

function createMMView(){
  mmviewWindow = new BrowserWindow({
    x: mmviewWinState.x,
    y: mmviewWinState.y,
    width: mmviewWinState.width,
    height: mmviewWinState.height,
    maxWidth: 600,
    maximizable: false,
    fullscreenable: false,
    title: 'marshmallow viewer',
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      preload: path.join(__dirname, 'mmview_inject.js')
    },
  });
  mmviewWindow.removeMenu();

  mmviewWindow.loadFile('mmview.html');

  mmviewWindow.on('close', (e) => {
    mmviewWinState.saveState(mmviewWindow);
    if (mainWindow){
      e.preventDefault();
      mmviewWindow.hide();
    }
  });
  mmviewWindow.on('closed', () => {
    mmviewWindow = null;
  });
  mmviewWindow.on('page-title-updated', (event, title, expSet) => {
    event.preventDefault();
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  updateConfig();
  createWindow();
  checkUpdate();
  
  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') app.quit()
});

function isNewVersion(curVer, newVer){
  const curSV = curVer.split('.');
  const newSV = newVer.split('.');
  for (let i=0;i<curSV.length;i++){
    if (parseInt(curSV[i]) < parseInt(newSV[i])) return true;
  }
  return false;
}

function checkUpdate(){
  if (!store.get('updateChecker.checkUpdate', true)) return;
  const url = store.get('updateChecker.updateUrl');
  https.get(url, (res) => {
    res.on('data', (chunk) => {
      let result = /"http.+\/releases\/tag\/(.+)"/.exec(chunk);
      if (!result) return;
      if (isNewVersion(app.getVersion(), result[1].substr(1))){
        //open dialog
        const selected = dialog.showMessageBoxSync(mainWindow, {
          type: 'info',
          buttons: ['開く', '無視'],
          title: '新しいバージョンがあります',
          message: '新しいバージョンがあります。リリースページを開きますか？\n現在のバージョン: v'+app.getVersion()+'\n新しいバージョン: '+result[1],
          cancelId: 1
        });
        if (selected == 0) shell.openExternal(store.get('updateChecker.updateUrl'));
      }
    });
  }).on('error', (e) => {
    console.error(e);
  });
}

// 既にローカルに保存されているConfigでアップデートによりデフォルト値が変わったものを変える
function updateConfig(){
  // v0.2.5 で更新。画像ダウンロード先のURLが変更になった。
  if (store.get('imageUrl') == 'https://cdn.marshmallow-qa.com/system/images/{uuid}.png'){
    store.set('imageUrl', defaultConfig.imageUrl);
  }
}
