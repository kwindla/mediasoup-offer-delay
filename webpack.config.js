const path = require('path');
const webpack = require('webpack');
const DashboardPlugin = require('webpack-dashboard/plugin');
const packageInfo = require('./package.json');

const base = {
  entry: {
    'soup-client': './soup-client.js'
  },
  output: {
    path: __dirname,
    filename: '[name]-bundle.js',
  },
  node: {
    fs: 'empty'
  },
  module: {
    loaders: [
      {
        test: /\.(js|jsx)$/,
        loader: 'babel-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.(json)$/,
        loader: 'json-loader',
      },
    ],
  },
  devtool: 'source-map',
  devServer: {
    host: '0.0.0.0',
    port: 8000,
    // We can start using it when we make all stuff hot-reloadable
    // new webpack.HotModuleReplacementPlugin(),
    hot: false,
    inline: false,
    contentBase: __dirname,

  }
};



module.exports = base;

