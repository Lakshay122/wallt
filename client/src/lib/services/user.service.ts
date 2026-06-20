import bcrypt from 'bcryptjs';
import { UserRepository } from '../repositories/user.repository';
import {
  createAgentSchema,
  updateAgentSchema,
  updateStatusSchema,
} from '../validators/user.validator';

const userRepository = new UserRepository();

export class UserService {
  private excludePassword<T extends { password?: string }>(user: T): Omit<T, 'password'> {
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  // 1. Create Agent
  async createAgent(
    input: unknown,
    currentUser: { tenantId: string; role: string }
  ) {
    // Role protection
    if (currentUser.role !== 'ADMIN') {
      return { success: false, message: 'Forbidden: Only ADMIN users can manage agents' };
    }

    // Input validation
    const parsed = createAgentSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: parsed.error.errors[0].message };
    }

    const { name, email, password } = parsed.data;

    try {
      // Prevent duplicate emails
      const existingUser = await userRepository.findByEmail(email);
      if (existingUser) {
        return { success: false, message: 'Email already in use' };
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Create user
      const newUser = await userRepository.create({
        name,
        email,
        password: hashedPassword,
        role: 'AGENT', // Role is always AGENT
        tenant: { connect: { id: currentUser.tenantId } },
        isActive: true,
      });

      return {
        success: true,
        data: this.excludePassword(newUser),
      };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to create agent' };
    }
  }

  // 2. Get Team Members
  async getTeamMembers(currentUser: { tenantId: string; role: string }) {
    // Role protection - both ADMIN and AGENT can fetch list of team members
    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'AGENT') {
      return { success: false, message: 'Forbidden: Unauthorized to view team members' };
    }

    try {
      const users = await userRepository.findManyByTenantId(currentUser.tenantId);
      const sanitizedUsers = users.map((u) => this.excludePassword(u));

      return {
        success: true,
        data: sanitizedUsers,
      };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to fetch team members' };
    }
  }

  // 3. Update Agent
  async updateAgent(
    id: string,
    input: unknown,
    currentUser: { tenantId: string; role: string }
  ) {
    // Role protection
    if (currentUser.role !== 'ADMIN') {
      return { success: false, message: 'Forbidden: Only ADMIN users can manage agents' };
    }

    // Input validation
    const parsed = updateAgentSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: parsed.error.errors[0].message };
    }

    const { name, email } = parsed.data;

    try {
      // Verify user exists and belongs to the same tenant
      const user = await userRepository.findById(id);
      if (!user || user.tenantId !== currentUser.tenantId) {
        return { success: false, message: 'Agent not found in this tenant' };
      }

      // Prevent duplicate emails
      if (email && email !== user.email) {
        const existingEmail = await userRepository.findByEmail(email);
        if (existingEmail) {
          return { success: false, message: 'Email already in use' };
        }
      }

      // Update fields
      const updatedUser = await userRepository.update(id, {
        name: name !== undefined ? name : undefined,
        email: email !== undefined ? email : undefined,
      });

      return {
        success: true,
        data: this.excludePassword(updatedUser),
      };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to update agent' };
    }
  }

  // 4. Enable / Disable Agent
  async updateAgentStatus(
    id: string,
    input: unknown,
    currentUser: { tenantId: string; role: string }
  ) {
    // Role protection
    if (currentUser.role !== 'ADMIN') {
      return { success: false, message: 'Forbidden: Only ADMIN users can manage agents' };
    }

    // Input validation
    const parsed = updateStatusSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: parsed.error.errors[0].message };
    }

    const { isActive } = parsed.data;

    try {
      // Verify user exists and belongs to the same tenant
      const user = await userRepository.findById(id);
      if (!user || user.tenantId !== currentUser.tenantId) {
        return { success: false, message: 'Agent not found in this tenant' };
      }

      const updatedUser = await userRepository.update(id, { isActive });

      return {
        success: true,
        data: this.excludePassword(updatedUser),
      };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to update status' };
    }
  }

  // 5. Delete Agent Permanently
  async deleteAgent(
    id: string,
    currentUser: { tenantId: string; role: string }
  ) {
    // Role protection
    if (currentUser.role !== 'ADMIN') {
      return { success: false, message: 'Forbidden: Only ADMIN users can manage agents' };
    }

    try {
      // Verify user exists and belongs to the same tenant
      const user = await userRepository.findById(id);
      if (!user || user.tenantId !== currentUser.tenantId) {
        return { success: false, message: 'Agent not found in this tenant' };
      }

      // Do not allow deleting ADMIN users
      if (user.role === 'ADMIN') {
        return { success: false, message: 'Cannot delete ADMIN users' };
      }

      await userRepository.delete(id);

      return {
        success: true,
        data: { message: 'Agent deleted successfully' },
      };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to delete agent' };
    }
  }
}
