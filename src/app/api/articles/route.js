import { NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';
import matter from 'gray-matter';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;
const articlesJsonPath = 'data/json/articles.json';
const mdFolderPath = 'data/md';

export async function GET(request) {
  try {
    console.log('Fetching articles...');
    console.log('GitHub Token:', process.env.GITHUB_TOKEN ? 'Set' : 'Not set');
    console.log('Owner:', process.env.GITHUB_OWNER);
    console.log('Repo:', process.env.GITHUB_REPO);
    console.log('Articles JSON Path:', articlesJsonPath);

    const { data } = await octokit.repos.getContent({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      path: articlesJsonPath,
    });

    console.log('GitHub API response:', data);

    const content = Buffer.from(data.content, 'base64').toString('utf8');
    console.log('Decoded content:', content);

    const articles = JSON.parse(content);
    console.log('Parsed articles:', articles);

    return NextResponse.json(articles);
  } catch (error) {
    console.error('Detailed error:', error);
    return NextResponse.json({ error: 'Failed to fetch articles', details: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  const { article } = await request.json();

  try {
    // Update the MD file
    await updateMdFile(article);

    // Sync articles
    await syncArticles();

    return NextResponse.json({ message: 'Article updated successfully' });
  } catch (error) {
    console.error('Error updating article:', error);
    return NextResponse.json({ error: 'Failed to update article' }, { status: 500 });
  }
}

async function syncArticles() {
  try {
    // Fetch all MD files
    const { data: files } = await octokit.repos.getContent({
      owner,
      repo,
      path: mdFolderPath,
    });

    const mdFiles = files.filter(file => file.name.endsWith('.md'));

    const articles = await Promise.all(mdFiles.map(async file => {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: file.path,
      });

      const content = Buffer.from(data.content, 'base64').toString('utf8');
      const { data: frontMatter, content: articleContent } = matter(content);

      // Fetch the last commit for this file
      const { data: commits } = await octokit.repos.listCommits({
        owner,
        repo,
        path: file.path,
        per_page: 1
      });

      const lastModified = commits[0]?.commit.committer.date || data.sha;

      return {
        title: frontMatter.title,
        description: frontMatter.description,
        date: frontMatter.date,
        lastModified: lastModified,
        path: file.path,
      };
    }));

    // Update articles.json
    const { data: currentFile } = await octokit.repos.getContent({
      owner,
      repo,
      path: articlesJsonPath,
    });

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: articlesJsonPath,
      message: 'Sync articles',
      content: Buffer.from(JSON.stringify(articles, null, 2)).toString('base64'),
      sha: currentFile.sha,
    });

  } catch (error) {
    console.error('Error syncing articles:', error);
    throw error;
  }
}

async function updateMdFile(article) {
  try {
    const { data: currentFile } = await octokit.repos.getContent({
      owner,
      repo,
      path: article.path,
    });

    const currentContent = Buffer.from(currentFile.content, 'base64').toString('utf8');
    const { data: frontMatter, content: articleContent } = matter(currentContent);

    const updatedFrontMatter = {
      ...frontMatter,
      title: article.title,
      description: article.description,
      lastModified: new Date().toISOString(),
    };

    const updatedContent = matter.stringify(article.content, updatedFrontMatter);

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: article.path,
      message: `Update article: ${article.title}`,
      content: Buffer.from(updatedContent).toString('base64'),
      sha: currentFile.sha,
    });

  } catch (error) {
    console.error('Error updating MD file:', error);
    throw error;
  }
}