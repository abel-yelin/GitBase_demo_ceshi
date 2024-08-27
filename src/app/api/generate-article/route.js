import OpenAI from 'openai';
import { Octokit } from '@octokit/rest';
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

export async function POST() {
  try {
    console.log('Starting article generation process');

    // 生成博客文章
    const blogPost = await generateBlogPost();
    console.log('Blog post generated:', blogPost.title);

    // 创建安全的文件名
    const safeFileName = createSafeFileName(blogPost.title);
    const filePath = `${process.env.GITHUB_POSTS_DIRECTORY}/${safeFileName}.md`;
    console.log('File path:', filePath);

    // 将文章内容提交到GitHub
    await commitToGitHub(filePath, blogPost.content);
    console.log('Committed to GitHub');

    // 更新articles.json
    await updateArticlesJson(blogPost);
    console.log('Updated articles.json');

    return NextResponse.json({ message: '博客文章已生成并保存', filePath });
  } catch (error) {
    console.error('生成文章时出错:', error);
    return NextResponse.json({ message: '生成文章时出现错误', error: error.message }, { status: 500 });
  }
}

async function generateBlogPost() {
  const prompt = `作为一个专业的博客作者，请创作一篇新的博客文章：

1. 要求：
   - 文章应该聚焦于以下主题之一：软件开发、Web技术、编程语言、开发工具、最佳实践
   - 文章长度应该在800到1200字之间
   - 使用标准的markdown格式，包括适当的标题层级（#、##、###等）
   - 包含一个引人入胜的主标题（使用单个#）
   - 提供一个简短的文章描述（不超过200字）
   - 分成几个小节，每个小节都有小标题（使用##）
   - 在文章末尾添加一个简短的总结

请按以下格式输出：

# [文章标题]

描述：[文章描述]

[文章正文，包括小节和总结]`;

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.choices[0].message.content;
  const lines = content.split('\n');
  const title = lines[0].replace('# ', '');
  const description = lines[2].replace('描述：', '');
  const body = lines.slice(3).join('\n');

  const frontmatter = `---
title: "${title}"
description: "${description}"
date: "${new Date().toISOString().split('T')[0]}"
---

`;

  return {
    title,
    description,
    content: frontmatter + body,
  };
}

async function commitToGitHub(filePath, content) {
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;

  try {
    const { data: ref } = await octokit.git.getRef({
      owner,
      repo,
      ref: 'heads/main',
    });

    const { data: commit } = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: ref.object.sha,
    });

    const { data: blobData } = await octokit.git.createBlob({
      owner,
      repo,
      content: Buffer.from(content).toString('base64'),
      encoding: 'base64',
    });

    const { data: tree } = await octokit.git.createTree({
      owner,
      repo,
      base_tree: commit.tree.sha,
      tree: [
        {
          path: filePath,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha,
        },
      ],
    });

    const { data: newCommit } = await octokit.git.createCommit({
      owner,
      repo,
      message: `Add new blog post: ${path.basename(filePath)}`,
      tree: tree.sha,
      parents: [commit.sha],
    });

    await octokit.git.updateRef({
      owner,
      repo,
      ref: 'heads/main',
      sha: newCommit.sha,
    });
  } catch (error) {
    console.error('Error in commitToGitHub:', error);
    throw error;
  }
}

async function updateArticlesJson(blogPost) {
  const articlesJsonPath = path.join(process.env.GITHUB_POSTS_DIRECTORY, '..', 'json', 'articles.json');
  
  let articles = [];
  try {
    const content = await fs.readFile(articlesJsonPath, 'utf-8');
    articles = JSON.parse(content);
  } catch (error) {
    console.warn('无法读取articles.json，将创建新文件');
  }

  articles.push({
    title: blogPost.title,
    description: blogPost.description,
    date: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    path: `${process.env.GITHUB_POSTS_DIRECTORY}/${createSafeFileName(blogPost.title)}.md`,
  });

  await fs.writeFile(articlesJsonPath, JSON.stringify(articles, null, 2));

  // 将更新后的articles.json提交到GitHub
  await commitToGitHub('data/json/articles.json', JSON.stringify(articles, null, 2));
}

function createSafeFileName(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}