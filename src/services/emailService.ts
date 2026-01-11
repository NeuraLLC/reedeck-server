import { resend } from '../config/resend';

interface InvitationEmailParams {
  toEmail: string;
  organizationName: string;
  inviterName: string;
  role: string;
  token: string;
}

export async function sendInvitationEmail({
  toEmail,
  organizationName,
  inviterName,
  role,
  token,
}: InvitationEmailParams) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const acceptInviteUrl = `${frontendUrl}/accept-invite?token=${token}`;

  try {
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@yourdomain.com',
      to: toEmail,
      subject: `You've been invited to join ${organizationName}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Team Invitation</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
              <h1 style="margin: 0 0 20px 0; color: #1a1a1a; font-size: 24px;">You've been invited!</h1>
              <p style="margin: 0 0 15px 0; font-size: 16px;">
                <strong>${inviterName}</strong> has invited you to join <strong>${organizationName}</strong> as a <strong>${role}</strong>.
              </p>
              <p style="margin: 0 0 25px 0; font-size: 16px; color: #666;">
                Click the button below to accept the invitation and get started.
              </p>
              <a href="${acceptInviteUrl}" style="display: inline-block; background-color: #007bff; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 600; font-size: 16px;">
                Accept Invitation
              </a>
            </div>
            <div style="font-size: 14px; color: #666;">
              <p style="margin: 0 0 10px 0;">
                This invitation will expire in 7 days.
              </p>
              <p style="margin: 0;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${acceptInviteUrl}" style="color: #007bff; word-break: break-all;">${acceptInviteUrl}</a>
              </p>
            </div>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error('Failed to send invitation email:', error);
      throw new Error(`Failed to send invitation email: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Error sending invitation email:', error);
    throw error;
  }
}

interface WelcomeEmailParams {
  toEmail: string;
  firstName: string;
  organizationName: string;
}

export async function sendWelcomeEmail({
  toEmail,
  firstName,
  organizationName,
}: WelcomeEmailParams) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const loginUrl = `${frontendUrl}/login`;

  try {
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@reedeck.com',
      to: toEmail,
      subject: `Welcome to Reedeck, ${firstName}!`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Welcome to Reedeck</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
              <h1 style="margin: 0 0 20px 0; color: #4D40E6; font-size: 24px;">Welcome to Reedeck!</h1>
              <p style="margin: 0 0 15px 0; font-size: 16px;">
                Hello ${firstName},
              </p>
              <p style="margin: 0 0 15px 0; font-size: 16px;">
                Your account for <strong>${organizationName}</strong> has been successfully created. We're excited to have you on board!
              </p>
              <p style="margin: 0 0 25px 0; font-size: 16px; color: #666;">
                You can now sign in to your dashboard to start managing your AI agents and customer support.
              </p>
              <a href="${loginUrl}" style="display: inline-block; background-color: #4D40E6; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 600; font-size: 16px;">
                Sign In to Dashboard
              </a>
            </div>
            <div style="font-size: 14px; color: #666;">
              <p style="margin: 0 0 10px 0;">
                If you haven't set your password yet, please use the "Forgot Password" link on the login page.
              </p>
              <p style="margin: 0;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${loginUrl}" style="color: #4D40E6; word-break: break-all;">${loginUrl}</a>
              </p>
            </div>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error('Failed to send welcome email:', error);
      throw new Error(`Failed to send welcome email: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw error;
  }
}
