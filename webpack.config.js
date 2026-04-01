//@ts-check

'use strict';

const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const webpack = require('webpack');

/** @type {import('webpack').Configuration} */
const mainConfig = {
  target: 'node',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode',
    'original-fs': 'original-fs'
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      'lodash$': path.resolve(__dirname, 'src/util/lodash-shim.ts')
    }
  },
  module: {
    rules: [
      {
        test: /\.(css|html)$/i,
        type: 'asset/source'
      },
      {
        test: /\.ts$/i,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'i18n/*.nls.*.json',
          to: path.resolve(__dirname, '[name][ext]')
        }
      ]
    }),
    new webpack.DefinePlugin({
      EXTENSION_ID: JSON.stringify(require('./package.json').name),
      VERSION: JSON.stringify(require('./package.json').version)
    })
  ],
  optimization: {
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          keep_classnames: /\w*Loader$/
        },
        extractComments: false
      })
    ]
  },
  performance: {
    hints: false
  }
};

/** @type {import('webpack').Configuration} */
const webviewJsConfig = {
  target: 'web',
  entry: {
    focustree: './webviewsrc/focustree.ts',
    gfx: './webviewsrc/gfx.ts',
    techtree: './webviewsrc/techtree.ts',
    worldmap: './webviewsrc/worldmap/index.ts',
    eventtree: './webviewsrc/eventtree.ts',
    guipreview: './webviewsrc/guipreview.ts',
    miopreview: './webviewsrc/miopreview.ts'
  },
  output: {
    path: path.resolve(__dirname, 'static'),
    filename: '[name].js'
  },
  devtool: 'source-map',
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      'lodash$': path.resolve(__dirname, 'src/util/lodash-shim.ts')
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/i,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'resource/**/*',
          to: path.resolve(__dirname, 'static', '[name][ext]')
        },
        {
          from: 'node_modules/@vscode/codicons/dist/codicon.css',
          to: path.resolve(__dirname, 'static', '[name][ext]')
        },
        {
          from: 'node_modules/@vscode/codicons/dist/codicon.ttf',
          to: path.resolve(__dirname, 'static', '[name][ext]')
        }
      ]
    })
  ],
  optimization: {
    splitChunks: {
      cacheGroups: {
        common: {
          name: 'common',
          chunks: 'initial',
          minChunks: 2,
          priority: 2
        }
      }
    }
  },
  performance: {
    hints: false
  }
};

module.exports = [mainConfig, webviewJsConfig];
